These are generated test images, not user captures or downloaded media.

- `alpha.png`: 64 × 32 RGBA, opaque/half-transparent/transparent regions.
- `rotated.jpg`: the same dimensions with EXIF orientation 6; output must be 32 × 64.
- `first-frame.gif` / `first-page.tiff`: two frames/pages; import must flatten the first and report it.
- `alpha.webp`, `small.bmp`, `small.heic`: alternate encodings of the same small image.
- `large.png`: 1024 × 512; its thumbnail must be 480 × 240.
- `oversized.png`: deliberately changed, CRC-correct IHDR dimensions (16385 × 1), to test rejection before pixel decoding.

PNG/JPEG/TIFF/GIF/BMP/WebP fixtures were generated with Pillow. HEIC was generated with macOS `sips -s format heic alpha.png --out small.heic`. The HEIC codec accesses hardware capability information, so the test must run outside a shell sandbox that blocks that access.

For an isolated release codec benchmark, set `CAPTURA_IMAGE_BENCH_DIR` to a directory containing a 3840 × 2160 `4k.png` and a 4000 × 3000 `12mp.jpg`, then run:

```sh
CAPTURA_IMAGE_BENCH_DIR=/tmp/captura-image-bench-input cargo test --manifest-path src-tauri/Cargo.toml --release image_pipeline_benchmark -- --ignored --nocapture
```

The benchmark compares the old 0.0.3 PNG conversion with the new full-image plus thumbnail pipeline, using one warmup and 30 samples per input/path. It measures codec wall time only. It does not measure window opening, keyboard response, queue rendering, or disk/SQLite persistence.
