//! AppKit snapshots stay on the main thread. ImageIO work owns only immutable
//! bytes and Core Foundation objects local to the calling background worker.

use std::{
    cell::RefCell,
    ffi::c_void,
    path::{Path, PathBuf},
    ptr,
    rc::Rc,
};

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSModalResponseCancel, NSModalResponseOK, NSOpenPanel, NSPasteboard, NSPasteboardTypeFileURL,
    NSPasteboardTypePNG, NSPasteboardTypeTIFF, NSScreenSaverWindowLevel,
};
use objc2_foundation::{NSArray, NSString, NSURL};

use crate::image_import::{
    check_file_size, validate_dimensions, ImageError, ImageInput, MAX_BATCH_BYTES, MAX_BATCH_FILES,
    THUMBNAIL_EDGE,
};

#[derive(Debug)]
pub struct NormalizedImage {
    pub png: Vec<u8>,
    pub thumbnail_png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub frame_count: usize,
}

#[derive(Debug)]
pub struct ImageThumbnail {
    pub png: Vec<u8>,
    /// Oriented original dimensions, not thumbnail dimensions.
    pub width: u32,
    pub height: u32,
}

/// Returning `None` means cancellation, while an unavailable panel is an error.
/// The callback runs on AppKit's main thread and must dispatch decoding away.
pub fn begin_choose_images(
    mtm: MainThreadMarker,
    completed: impl FnOnce(Result<Option<Vec<ImageInput>>, String>) + 'static,
) {
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(true);
    panel.setResolvesAliases(true);
    panel.setTitle(Some(&NSString::from_str("Choose images")));
    panel.setPrompt(Some(&NSString::from_str("Add images")));
    // Captura's home uses this overlay level. Put the modeless native picker
    // above it without hiding the queue or running a nested modal event loop.
    panel.setLevel(NSScreenSaverWindowLevel + 1);
    let extensions: Vec<_> = [
        "png", "jpg", "jpeg", "tif", "tiff", "heic", "heif", "webp", "gif", "bmp",
    ]
    .into_iter()
    .map(NSString::from_str)
    .collect();
    let extensions = NSArray::from_retained_slice(&extensions);
    #[allow(deprecated)]
    panel.setAllowedFileTypes(Some(&extensions));
    panel.setAllowsOtherFileTypes(false);
    // Take both retained resources out when invoked. AppKit retains its block
    // until dismissal; no permanent panel -> block -> panel cycle remains.
    let state = Rc::new(RefCell::new(Some((panel.clone(), completed))));
    let completion = RcBlock::new(move |response| {
        let Some((panel, completed)) = state.borrow_mut().take() else {
            return;
        };
        let result = if response == NSModalResponseOK {
            let paths = panel
                .URLs()
                .iter()
                .filter_map(|url| url.path())
                .map(|path| ImageInput::File(PathBuf::from(path.to_string())))
                .collect();
            Ok(Some(paths))
        } else if response == NSModalResponseCancel {
            Ok(None)
        } else {
            Err("The image picker could not be opened.".to_string())
        };
        completed(result);
    });
    panel.beginWithCompletionHandler(&completion);
}

/// Snapshot each pasteboard item once. Prefer its image bytes to a file URL;
/// never import both representations or follow a remote image URL.
pub fn snapshot_clipboard_images(_mtm: MainThreadMarker) -> Vec<ImageInput> {
    snapshot_pasteboard_images(&NSPasteboard::generalPasteboard())
}

/// Accepts an actual dragging-session pasteboard as well as the clipboard.
/// Caller must be on AppKit's main thread. No decode or file read occurs here.
pub fn snapshot_pasteboard_images(pasteboard: &NSPasteboard) -> Vec<ImageInput> {
    let Some(items) = pasteboard.pasteboardItems() else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut total_bytes = 0u64;
    for (index, item) in items.iter().enumerate() {
        if result.len() > MAX_BATCH_FILES {
            break;
        }
        let mut image = None;
        for flavor in [unsafe { NSPasteboardTypePNG }, unsafe {
            NSPasteboardTypeTIFF
        }] {
            let Some(data) = item.dataForType(flavor) else {
                continue;
            };
            let label = format!("Clipboard image {}", index + 1);
            let length = data.len() as u64;
            image = Some(match check_file_size(length) {
                Err(error) => ImageInput::Rejected { label, error },
                Ok(length) if total_bytes.saturating_add(length) > MAX_BATCH_BYTES => {
                    ImageInput::Rejected {
                        label,
                        error: ImageError::new(
                            "batch_too_large",
                            "The clipboard images exceed the 200 MiB batch limit.",
                        ),
                    }
                }
                Ok(length) => {
                    total_bytes += length;
                    ImageInput::Bytes {
                        label,
                        bytes: data.to_vec(),
                    }
                }
            });
            break;
        }
        if let Some(image) = image {
            result.push(image);
            continue;
        }
        if let Some(value) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
            if let Some(url) = NSURL::URLWithString(&value) {
                if url.isFileURL() {
                    if let Some(path) = url.path() {
                        result.push(ImageInput::File(PathBuf::from(path.to_string())));
                    }
                }
            }
        }
    }
    result
}

// These are stable C APIs provided by macOS. Each Create/Copy result is wrapped
// immediately in OwnedCf and released on this worker; borrowed Get results are
// never released or sent to another thread. The narrow FFI avoids pulling a
// second image codec into the app just to repeat ImageIO's native validation.
type Cf = *const c_void;
type CfMut = *mut c_void;
type CgImage = *const c_void;

#[repr(C)]
struct DictionaryKeyCallbacks {
    version: isize,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
    equal: *const c_void,
    hash: *const c_void,
}

#[repr(C)]
struct DictionaryValueCallbacks {
    version: isize,
    retain: *const c_void,
    release: *const c_void,
    copy_description: *const c_void,
    equal: *const c_void,
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: Cf;
    static kCFBooleanFalse: Cf;
    static kCFAllocatorNull: Cf;
    static kCFTypeDictionaryKeyCallBacks: DictionaryKeyCallbacks;
    static kCFTypeDictionaryValueCallBacks: DictionaryValueCallbacks;
    fn CFRelease(value: Cf);
    fn CFGetTypeID(value: Cf) -> usize;
    fn CFDataCreateWithBytesNoCopy(
        allocator: Cf,
        bytes: *const u8,
        length: isize,
        bytes_deallocator: Cf,
    ) -> Cf;
    fn CFDataCreateMutable(allocator: Cf, capacity: isize) -> CfMut;
    fn CFDataGetLength(data: Cf) -> isize;
    fn CFDataGetBytePtr(data: Cf) -> *const u8;
    fn CFDictionaryCreate(
        allocator: Cf,
        keys: *const Cf,
        values: *const Cf,
        count: isize,
        key_callbacks: *const DictionaryKeyCallbacks,
        value_callbacks: *const DictionaryValueCallbacks,
    ) -> Cf;
    fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
    fn CFNumberCreate(allocator: Cf, kind: isize, value: *const c_void) -> Cf;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(number: Cf, kind: isize, value: *mut c_void) -> u8;
    fn CFStringCreateWithCString(allocator: Cf, text: *const i8, encoding: u32) -> Cf;
    fn CFStringGetCString(string: Cf, buffer: *mut i8, capacity: isize, encoding: u32) -> u8;
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: Cf,
        bytes: *const u8,
        length: isize,
        directory: u8,
    ) -> Cf;
}

#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    static kCGImageSourceShouldCache: Cf;
    static kCGImageSourceShouldCacheImmediately: Cf;
    static kCGImageSourceCreateThumbnailFromImageAlways: Cf;
    static kCGImageSourceCreateThumbnailWithTransform: Cf;
    static kCGImageSourceThumbnailMaxPixelSize: Cf;
    static kCGImagePropertyPixelWidth: Cf;
    static kCGImagePropertyPixelHeight: Cf;
    static kCGImagePropertyOrientation: Cf;
    fn CGImageSourceCreateWithData(data: Cf, options: Cf) -> Cf;
    fn CGImageSourceCreateWithURL(url: Cf, options: Cf) -> Cf;
    fn CGImageSourceGetType(source: Cf) -> Cf;
    fn CGImageSourceGetCount(source: Cf) -> usize;
    fn CGImageSourceGetStatus(source: Cf) -> i32;
    fn CGImageSourceCopyPropertiesAtIndex(source: Cf, index: usize, options: Cf) -> Cf;
    fn CGImageSourceCreateImageAtIndex(source: Cf, index: usize, options: Cf) -> CgImage;
    fn CGImageSourceCreateThumbnailAtIndex(source: Cf, index: usize, options: Cf) -> CgImage;
    fn CGImageDestinationCreateWithData(data: CfMut, kind: Cf, count: usize, options: Cf) -> Cf;
    fn CGImageDestinationAddImage(destination: Cf, image: CgImage, properties: Cf);
    fn CGImageDestinationFinalize(destination: Cf) -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetWidth(image: CgImage) -> usize;
    fn CGImageGetHeight(image: CgImage) -> usize;
}

struct OwnedCf(Cf);

impl OwnedCf {
    fn new(value: Cf, message: &'static str) -> Result<Self, ImageError> {
        if value.is_null() {
            Err(ImageError::new("invalid_image", message))
        } else {
            Ok(Self(value))
        }
    }
}

impl Drop for OwnedCf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

fn dictionary(entries: &[(Cf, Cf)]) -> Result<OwnedCf, ImageError> {
    let keys: Vec<_> = entries.iter().map(|entry| entry.0).collect();
    let values: Vec<_> = entries.iter().map(|entry| entry.1).collect();
    OwnedCf::new(
        unsafe {
            CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                entries.len() as isize,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            )
        },
        "Could not allocate image options.",
    )
}

fn number(value: i64) -> Result<OwnedCf, ImageError> {
    OwnedCf::new(
        unsafe { CFNumberCreate(ptr::null(), 4, ptr::from_ref(&value).cast()) },
        "Could not allocate an image dimension.",
    )
}

fn property_u32(properties: Cf, key: Cf) -> Option<u32> {
    let value = unsafe { CFDictionaryGetValue(properties, key) };
    if value.is_null() || unsafe { CFGetTypeID(value) != CFNumberGetTypeID() } {
        return None;
    }
    let mut result = 0i64;
    if unsafe { CFNumberGetValue(value, 4, ptr::from_mut(&mut result).cast()) } == 0 {
        return None;
    }
    u32::try_from(result).ok()
}

fn cf_string(value: Cf) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut buffer = [0u8; 256];
    if unsafe {
        CFStringGetCString(
            value,
            buffer.as_mut_ptr().cast(),
            buffer.len() as isize,
            0x0800_0100,
        )
    } == 0
    {
        return None;
    }
    let end = buffer.iter().position(|byte| *byte == 0)?;
    String::from_utf8(buffer[..end].to_vec()).ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
    Tiff,
    Heic,
    Webp,
    Gif,
    Bmp,
}

fn magic_format(bytes: &[u8]) -> Option<Format> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Format::Png);
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some(Format::Jpeg);
    }
    if bytes.starts_with(b"II\x2a\0")
        || bytes.starts_with(b"MM\0\x2a")
        || bytes.starts_with(b"II\x2b\0")
        || bytes.starts_with(b"MM\0\x2b")
    {
        return Some(Format::Tiff);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    if bytes.starts_with(b"BM") {
        return Some(Format::Bmp);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(Format::Webp);
    }
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let box_size = u32::from_be_bytes(bytes[..4].try_into().ok()?) as usize;
        if box_size >= 16 && box_size <= bytes.len() {
            let (compatible_brands, _) = bytes[16..box_size].as_chunks::<4>();
            let brands = std::iter::once(&bytes[8..12])
                .chain(compatible_brands.iter().map(|brand| brand.as_slice()));
            if brands.into_iter().any(|brand| {
                matches!(
                    brand,
                    b"heic" | b"heix" | b"hevc" | b"hevx" | b"mif1" | b"msf1"
                )
            }) {
                return Some(Format::Heic);
            }
        }
    }
    None
}

fn decoded_format(kind: &str) -> Option<Format> {
    match kind {
        "public.png" => Some(Format::Png),
        "public.jpeg" => Some(Format::Jpeg),
        "public.tiff" => Some(Format::Tiff),
        "public.heic" | "public.heif" | "public.heics" => Some(Format::Heic),
        "org.webmproject.webp" => Some(Format::Webp),
        "com.compuserve.gif" => Some(Format::Gif),
        "com.microsoft.bmp" => Some(Format::Bmp),
        _ => None,
    }
}

struct Source<'a> {
    source: OwnedCf,
    // The source retains its data. Keep the data and borrowed byte slice alive
    // until after the source is dropped; CF owns no Rust allocation.
    _data: OwnedCf,
    _bytes: &'a [u8],
    width: u32,
    height: u32,
    frames: usize,
    preserve_png: bool,
    requires_transform: bool,
}

impl<'a> Source<'a> {
    fn new(bytes: &'a [u8]) -> Result<Self, ImageError> {
        check_file_size(bytes.len() as u64)?;
        let expected = magic_format(bytes).ok_or_else(|| {
            ImageError::new(
                "unsupported_format",
                "Choose a PNG, JPEG, TIFF, HEIC, WebP, GIF, or BMP image.",
            )
        })?;
        let options = dictionary(&[(unsafe { kCGImageSourceShouldCache }, unsafe {
            kCFBooleanFalse
        })])?;
        let data = OwnedCf::new(
            unsafe {
                CFDataCreateWithBytesNoCopy(
                    ptr::null(),
                    bytes.as_ptr(),
                    bytes.len() as isize,
                    kCFAllocatorNull,
                )
            },
            "Could not read image bytes.",
        )?;
        let source = OwnedCf::new(
            unsafe { CGImageSourceCreateWithData(data.0, options.0) },
            "The image data is corrupt or unsupported.",
        )?;
        Self::inspect(source, data, bytes, expected, &options)
    }

    fn inspect(
        source: OwnedCf,
        data: OwnedCf,
        bytes: &'a [u8],
        expected: Format,
        options: &OwnedCf,
    ) -> Result<Self, ImageError> {
        let kind = cf_string(unsafe { CGImageSourceGetType(source.0) })
            .and_then(|kind| decoded_format(&kind));
        if kind != Some(expected) {
            return Err(ImageError::new(
                "unsupported_format",
                "The decoded image format is unsupported or does not match its header.",
            ));
        }
        if unsafe { CGImageSourceGetStatus(source.0) } != 0 {
            return Err(ImageError::new(
                "invalid_image",
                "The image data is incomplete or corrupt.",
            ));
        }
        let frames = unsafe { CGImageSourceGetCount(source.0) };
        if frames == 0 {
            return Err(ImageError::new(
                "invalid_image",
                "The image contains no frames.",
            ));
        }
        let properties = OwnedCf::new(
            unsafe { CGImageSourceCopyPropertiesAtIndex(source.0, 0, options.0) },
            "Could not read image dimensions.",
        )?;
        let mut width =
            property_u32(properties.0, unsafe { kCGImagePropertyPixelWidth }).unwrap_or_default();
        let mut height =
            property_u32(properties.0, unsafe { kCGImagePropertyPixelHeight }).unwrap_or_default();
        validate_dimensions(width, height)?;
        let orientation =
            property_u32(properties.0, unsafe { kCGImagePropertyOrientation }).unwrap_or(1);
        if matches!(orientation, 5..=8) {
            std::mem::swap(&mut width, &mut height);
        }
        let preserve_png = expected == Format::Png && frames == 1 && orientation == 1;
        Ok(Self {
            source,
            _data: data,
            _bytes: bytes,
            width,
            height,
            frames,
            preserve_png,
            requires_transform: orientation != 1,
        })
    }

    fn original(&self) -> Result<OwnedCf, ImageError> {
        if self.requires_transform || self.preserve_png {
            // A PNG we will reuse must still complete a pixel decode. ImageIO
            // also applies orientation here for formats that require it.
            return self.decode(self.width.max(self.height));
        }
        // The full-size thumbnail path drew an extra raster before encoding
        // upright JPEGs. Let the encoder consume ImageIO's original CGImage
        // directly; the 480px preview still uses bounded thumbnail decoding.
        let options = dictionary(&[(unsafe { kCGImageSourceShouldCache }, unsafe {
            kCFBooleanFalse
        })])?;
        OwnedCf::new(
            unsafe { CGImageSourceCreateImageAtIndex(self.source.0, 0, options.0) },
            "The image could not be decoded.",
        )
    }

    fn decode(&self, maximum_edge: u32) -> Result<OwnedCf, ImageError> {
        let maximum = number(i64::from(maximum_edge))?;
        let options = dictionary(&[
            (unsafe { kCGImageSourceShouldCache }, unsafe {
                kCFBooleanFalse
            }),
            (unsafe { kCGImageSourceShouldCacheImmediately }, unsafe {
                kCFBooleanTrue
            }),
            (
                unsafe { kCGImageSourceCreateThumbnailFromImageAlways },
                unsafe { kCFBooleanTrue },
            ),
            (
                unsafe { kCGImageSourceCreateThumbnailWithTransform },
                unsafe { kCFBooleanTrue },
            ),
            (unsafe { kCGImageSourceThumbnailMaxPixelSize }, maximum.0),
        ])?;
        let image = OwnedCf::new(
            unsafe { CGImageSourceCreateThumbnailAtIndex(self.source.0, 0, options.0) },
            "The image could not be decoded.",
        )?;
        let width = unsafe { CGImageGetWidth(image.0) };
        let height = unsafe { CGImageGetHeight(image.0) };
        if width == 0 || height == 0 || width.max(height) > maximum_edge as usize {
            return Err(ImageError::new(
                "invalid_dimensions",
                "The decoded image dimensions do not match the requested limit.",
            ));
        }
        Ok(image)
    }
}

fn png(image: &OwnedCf) -> Result<Vec<u8>, ImageError> {
    let kind = OwnedCf::new(
        unsafe { CFStringCreateWithCString(ptr::null(), c"public.png".as_ptr(), 0x0800_0100) },
        "Could not allocate PNG options.",
    )?;
    let data = OwnedCf::new(
        unsafe { CFDataCreateMutable(ptr::null(), 0) },
        "Could not allocate PNG data.",
    )?;
    let destination = OwnedCf::new(
        unsafe { CGImageDestinationCreateWithData(data.0.cast_mut(), kind.0, 1, ptr::null()) },
        "Could not create a PNG encoder.",
    )?;
    unsafe {
        CGImageDestinationAddImage(destination.0, image.0, ptr::null());
    }
    if unsafe { CGImageDestinationFinalize(destination.0) } == 0 {
        return Err(ImageError::new(
            "image_encode_failed",
            "The image could not be saved as PNG.",
        ));
    }
    let length = unsafe { CFDataGetLength(data.0) };
    let pointer = unsafe { CFDataGetBytePtr(data.0) };
    if length <= 0 || pointer.is_null() {
        return Err(ImageError::new(
            "image_encode_failed",
            "The PNG encoder returned no image data.",
        ));
    }
    Ok(unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec())
}

pub fn normalize(bytes: &[u8]) -> Result<NormalizedImage, ImageError> {
    let source = Source::new(bytes)?;
    let original = source.original()?;
    let width = unsafe { CGImageGetWidth(original.0) } as u32;
    let height = unsafe { CGImageGetHeight(original.0) } as u32;
    validate_dimensions(width, height)?;
    // A validated, single-frame, upright PNG is already normalized. Keeping its
    // bytes avoids unnecessary recompression and preserves semitransparent RGB
    // values that a premultiply/unpremultiply round trip can round by one.
    let normalized_png = if source.preserve_png {
        bytes.to_vec()
    } else {
        png(&original)?
    };
    drop(original);
    let thumbnail = source.decode(THUMBNAIL_EDGE)?;
    let thumbnail_png = png(&thumbnail)?;
    Ok(NormalizedImage {
        png: normalized_png,
        thumbnail_png,
        width,
        height,
        frame_count: source.frames,
    })
}

#[cfg(test)]
pub fn thumbnail(bytes: &[u8]) -> Result<ImageThumbnail, ImageError> {
    let source = Source::new(bytes)?;
    let image = source.decode(THUMBNAIL_EDGE)?;
    Ok(ImageThumbnail {
        png: png(&image)?,
        width: source.width,
        height: source.height,
    })
}

/// Managed originals can be larger than the encoded-input limit after converting
/// a compact JPEG into PNG. ImageIO reads these from disk without loading the
/// entire encoded original into Rust memory, and still validates pixel limits.
pub fn thumbnail_from_file(path: &Path) -> Result<ImageThumbnail, ImageError> {
    use std::{io::Read, os::unix::ffi::OsStrExt};
    let io_error = |error: std::io::Error| ImageError::new("file_io", error.to_string());
    let mut file = std::fs::File::open(path).map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    let maximum_normalized_bytes = crate::image_import::MAX_IMAGE_PIXELS * 8 + 1024 * 1024;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum_normalized_bytes {
        return Err(ImageError::new(
            "image_too_large",
            "The managed original is not a valid bounded image file.",
        ));
    }
    let mut header = [0u8; 4096];
    let count = file.read(&mut header).map_err(io_error)?;
    let expected = magic_format(&header[..count]).ok_or_else(|| {
        ImageError::new(
            "unsupported_format",
            "The managed original is not a supported image.",
        )
    })?;
    let path_bytes = path.as_os_str().as_bytes();
    let url = OwnedCf::new(
        unsafe {
            CFURLCreateFromFileSystemRepresentation(
                ptr::null(),
                path_bytes.as_ptr(),
                path_bytes.len() as isize,
                0,
            )
        },
        "Could not read the managed image path.",
    )?;
    let options = dictionary(&[(unsafe { kCGImageSourceShouldCache }, unsafe {
        kCFBooleanFalse
    })])?;
    let source = OwnedCf::new(
        unsafe { CGImageSourceCreateWithURL(url.0, options.0) },
        "Could not read the managed image.",
    )?;
    let source = Source::inspect(source, url, &[], expected, &options)?;
    let image = source.decode(THUMBNAIL_EDGE)?;
    Ok(ImageThumbnail {
        png: png(&image)?,
        width: source.width,
        height: source.height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = include_bytes!("../../tests/fixtures/images/alpha.png");

    #[test]
    fn pasteboard_snapshot_prefers_pixels_and_reads_finder_file_urls() {
        use objc2::runtime::ProtocolObject;
        use objc2_app_kit::{NSPasteboardItem, NSPasteboardWriting};
        use objc2_foundation::NSData;
        struct TestPasteboard(objc2::rc::Retained<NSPasteboard>);
        impl Drop for TestPasteboard {
            fn drop(&mut self) {
                self.0.clearContents();
            }
        }
        // An isolated named pasteboard never changes the user's clipboard.
        let board = TestPasteboard(NSPasteboard::pasteboardWithUniqueName());
        let image = NSPasteboardItem::new();
        assert!(image.setData_forType(&NSData::with_bytes(PNG), unsafe { NSPasteboardTypePNG }));
        assert!(image.setString_forType(
            &NSString::from_str("file:///tmp/duplicate-image.png"),
            unsafe { NSPasteboardTypeFileURL }
        ));
        let file = NSPasteboardItem::new();
        assert!(file.setString_forType(
            &NSString::from_str("file:///tmp/Finder%20Image.png"),
            unsafe { NSPasteboardTypeFileURL }
        ));
        let remote = NSPasteboardItem::new();
        assert!(remote.setString_forType(
            &NSString::from_str("https://example.com/remote.png"),
            unsafe { NSPasteboardTypeFileURL }
        ));
        let items: [&ProtocolObject<dyn NSPasteboardWriting>; 3] = [
            ProtocolObject::from_ref(&*image),
            ProtocolObject::from_ref(&*file),
            ProtocolObject::from_ref(&*remote),
        ];
        assert!(board.0.writeObjects(&NSArray::from_slice(&items)));
        let inputs = snapshot_pasteboard_images(&board.0);
        assert_eq!(inputs.len(), 2);
        assert!(matches!(&inputs[0], ImageInput::Bytes { bytes, .. } if bytes == PNG));
        assert!(
            matches!(&inputs[1], ImageInput::File(path) if path == Path::new("/tmp/Finder Image.png"))
        );
    }

    #[test]
    fn decodes_all_supported_formats_with_actual_imageio() {
        type Fixture = (&'static str, &'static [u8], (u32, u32), usize);
        let fixtures: &[Fixture] = &[
            ("PNG", PNG, (64, 32), 1),
            (
                "JPEG",
                include_bytes!("../../tests/fixtures/images/rotated.jpg"),
                (32, 64),
                1,
            ),
            (
                "TIFF",
                include_bytes!("../../tests/fixtures/images/first-page.tiff"),
                (64, 32),
                2,
            ),
            (
                "HEIC",
                include_bytes!("../../tests/fixtures/images/small.heic"),
                (64, 32),
                1,
            ),
            (
                "WebP",
                include_bytes!("../../tests/fixtures/images/alpha.webp"),
                (64, 32),
                1,
            ),
            (
                "GIF",
                include_bytes!("../../tests/fixtures/images/first-frame.gif"),
                (64, 32),
                2,
            ),
            (
                "BMP",
                include_bytes!("../../tests/fixtures/images/small.bmp"),
                (64, 32),
                1,
            ),
        ];
        for (name, bytes, dimensions, frames) in fixtures {
            let image = normalize(bytes).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!((image.width, image.height), *dimensions, "{name}");
            assert_eq!(image.frame_count, *frames, "{name}");
            assert!(image.png.starts_with(b"\x89PNG\r\n\x1a\n"));
            let reopened = Source::new(&image.png).unwrap();
            assert_eq!((reopened.width, reopened.height), *dimensions);
            let thumbnail = Source::new(&image.thumbnail_png).unwrap();
            assert!(thumbnail.width.max(thumbnail.height) <= THUMBNAIL_EDGE);
        }
    }

    #[test]
    fn downsampled_thumbnail_keeps_original_resolution_metadata() {
        let bytes = include_bytes!("../../tests/fixtures/images/large.png");
        let image = normalize(bytes).unwrap();
        assert_eq!((image.width, image.height), (1024, 512));
        let preview = Source::new(&image.thumbnail_png).unwrap();
        assert_eq!((preview.width, preview.height), (480, 240));
        let legacy = thumbnail(bytes).unwrap();
        assert_eq!((legacy.width, legacy.height), (1024, 512));
    }

    #[test]
    fn normalization_preserves_transparent_png_pixels() {
        unsafe extern "C" {
            fn CGImageSourceCreateImageAtIndex(source: Cf, index: usize, options: Cf) -> CgImage;
            fn CGImageGetDataProvider(image: CgImage) -> Cf;
            fn CGDataProviderCopyData(provider: Cf) -> Cf;
        }
        let pixels = |bytes: &[u8]| {
            let source = Source::new(bytes).unwrap();
            let image = OwnedCf::new(
                unsafe { CGImageSourceCreateImageAtIndex(source.source.0, 0, ptr::null()) },
                "test image",
            )
            .unwrap();
            let data = OwnedCf::new(
                unsafe { CGDataProviderCopyData(CGImageGetDataProvider(image.0)) },
                "test pixels",
            )
            .unwrap();
            unsafe {
                std::slice::from_raw_parts(
                    CFDataGetBytePtr(data.0),
                    CFDataGetLength(data.0) as usize,
                )
            }
            .to_vec()
        };
        let normalized = normalize(PNG).unwrap();
        assert_eq!(pixels(PNG), pixels(&normalized.png));
    }

    #[test]
    fn rejects_disguised_and_truncated_files_before_decode() {
        assert_eq!(
            normalize(b"not really an image.png").unwrap_err().code,
            "unsupported_format"
        );
        assert!(normalize(b"\x89PNG\r\n\x1a\n").is_err());
        assert!(normalize(b"\xff\xd8\xff").is_err());
        let oversized = include_bytes!("../../tests/fixtures/images/oversized.png");
        assert_eq!(
            normalize(oversized).unwrap_err().code,
            "image_dimensions_exceeded"
        );
    }

    /// Compare the old 0.0.3 codec with the complete new normalize+thumbnail
    /// path using the same bytes. This isolates codec cost; it is not a claim
    /// about panel latency or native event handling.
    #[test]
    #[ignore = "requires CAPTURA_IMAGE_BENCH_DIR containing 4k.png and 12mp.jpg"]
    fn image_pipeline_benchmark() {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
        use objc2_foundation::{NSData, NSDictionary};
        use std::time::Instant;
        let root = PathBuf::from(
            std::env::var("CAPTURA_IMAGE_BENCH_DIR").expect("set CAPTURA_IMAGE_BENCH_DIR"),
        );
        for name in ["4k.png", "12mp.jpg"] {
            let bytes = std::fs::read(root.join(name)).unwrap();
            let old = || {
                autoreleasepool(|_| {
                    let data = NSData::with_bytes(&bytes);
                    let bitmap = NSBitmapImageRep::imageRepWithData(&data).unwrap();
                    let png = unsafe {
                        bitmap.representationUsingType_properties(
                            NSBitmapImageFileType::PNG,
                            &NSDictionary::new(),
                        )
                    }
                    .unwrap();
                    std::hint::black_box(png.to_vec());
                });
            };
            let new = || {
                std::hint::black_box(normalize(&bytes).unwrap());
            };
            old();
            new();
            for (label, run) in [
                ("0.0.3-normalize", &old as &dyn Fn()),
                ("new-normalize-and-thumbnail", &new as &dyn Fn()),
            ] {
                let mut samples = Vec::new();
                for _ in 0..30 {
                    let start = Instant::now();
                    run();
                    samples.push(start.elapsed().as_secs_f64() * 1000.0);
                }
                samples.sort_by(f64::total_cmp);
                println!(
                    "{name} {label}: n=30 median={:.2}ms p95={:.2}ms max={:.2}ms",
                    samples[15], samples[28], samples[29]
                );
            }
        }
    }

    #[test]
    #[ignore = "requires CAPTURA_IMAGE_BENCH_DIR containing 12mp.jpg"]
    fn image_pipeline_stage_benchmark() {
        use std::time::Instant;
        unsafe extern "C" {
            fn CGImageSourceCreateImageAtIndex(source: Cf, index: usize, options: Cf) -> CgImage;
            fn CGImageGetBitsPerPixel(image: CgImage) -> usize;
            fn CGImageGetAlphaInfo(image: CgImage) -> u32;
        }
        let root = PathBuf::from(
            std::env::var("CAPTURA_IMAGE_BENCH_DIR").expect("set CAPTURA_IMAGE_BENCH_DIR"),
        );
        let bytes = std::fs::read(root.join("12mp.jpg")).unwrap();
        for direct in [false, true] {
            for _ in 0..3 {
                let start = Instant::now();
                let source = Source::new(&bytes).unwrap();
                let metadata_ms = start.elapsed().as_secs_f64() * 1000.;
                let start = Instant::now();
                let image = if direct {
                    OwnedCf::new(
                        unsafe { CGImageSourceCreateImageAtIndex(source.source.0, 0, ptr::null()) },
                        "direct decode",
                    )
                    .unwrap()
                } else {
                    source.decode(source.width.max(source.height)).unwrap()
                };
                let decode_ms = start.elapsed().as_secs_f64() * 1000.;
                let bits = unsafe { CGImageGetBitsPerPixel(image.0) };
                let alpha = unsafe { CGImageGetAlphaInfo(image.0) };
                let start = Instant::now();
                let full = png(&image).unwrap();
                let encode_ms = start.elapsed().as_secs_f64() * 1000.;
                drop(image);
                let start = Instant::now();
                let thumbnail = source.decode(THUMBNAIL_EDGE).unwrap();
                let small = png(&thumbnail).unwrap();
                let thumbnail_ms = start.elapsed().as_secs_f64() * 1000.;
                println!("direct={direct} metadata={metadata_ms:.2}ms decode={decode_ms:.2}ms encode={encode_ms:.2}ms thumbnail={thumbnail_ms:.2}ms bits={bits} alpha={alpha} PNG_bytes={} PNG_color={} thumbnail_bytes={}", full.len(), full[25], small.len());
            }
        }
    }
}
