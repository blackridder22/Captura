// Generates Captura's app icon (1024) and menu-bar template icon.
// Run: swift script/generate_icons.swift <output-dir>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outputDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp"

func makeContext(_ size: Int) -> CGContext {
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    return CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
}

func savePNG(_ context: CGContext, _ name: String) {
    let image = context.makeImage()!
    let url = URL(fileURLWithPath: "\(outputDir)/\(name)") as CFURL
    let destination = CGImageDestinationCreateWithURL(
        url, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
    print("wrote \(outputDir)/\(name)")
}

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

// Viewfinder corner brackets + capture dot, centered in `frame`.
func drawGlyph(
    _ ctx: CGContext, frame: CGRect, thickness: CGFloat, cornerLength: CGFloat,
    dotRadius: CGFloat, stroke: CGColor, fill: CGColor
) {
    ctx.setLineWidth(thickness)
    ctx.setLineCap(.round)
    ctx.setStrokeColor(stroke)

    let (minX, maxX) = (frame.minX, frame.maxX)
    let (minY, maxY) = (frame.minY, frame.maxY)
    let corners: [[CGPoint]] = [
        [CGPoint(x: minX, y: minY + cornerLength), CGPoint(x: minX, y: minY),
         CGPoint(x: minX + cornerLength, y: minY)],
        [CGPoint(x: maxX - cornerLength, y: minY), CGPoint(x: maxX, y: minY),
         CGPoint(x: maxX, y: minY + cornerLength)],
        [CGPoint(x: maxX, y: maxY - cornerLength), CGPoint(x: maxX, y: maxY),
         CGPoint(x: maxX - cornerLength, y: maxY)],
        [CGPoint(x: minX + cornerLength, y: maxY), CGPoint(x: minX, y: maxY),
         CGPoint(x: minX, y: maxY - cornerLength)],
    ]
    for corner in corners {
        ctx.beginPath()
        ctx.move(to: corner[0])
        ctx.addLine(to: corner[1])
        ctx.addLine(to: corner[2])
        ctx.strokePath()
    }

    ctx.setFillColor(fill)
    let center = CGPoint(x: frame.midX, y: frame.midY)
    ctx.fillEllipse(
        in: CGRect(
            x: center.x - dotRadius, y: center.y - dotRadius,
            width: dotRadius * 2, height: dotRadius * 2))
}

// ---- App icon (1024, Big Sur rounded-square with margin) ----
do {
    let size = 1024
    let ctx = makeContext(size)
    let content = CGRect(x: 100, y: 100, width: 824, height: 824)
    let radius: CGFloat = 186

    let squircle = CGPath(roundedRect: content, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.addPath(squircle)
    ctx.clip()

    // Graphite glass background.
    let bgGradient = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        colors: [color(0x24272B), color(0x0D0E10)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(
        bgGradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

    // Soft copper glow behind the glyph.
    let glow = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        colors: [color(0xF08B64, 0.32), color(0xF08B64, 0.0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(
        glow, startCenter: CGPoint(x: 512, y: 512), startRadius: 0,
        endCenter: CGPoint(x: 512, y: 512), endRadius: 430, options: [])

    // Inner top highlight.
    ctx.setStrokeColor(color(0xFFFFFF, 0.07))
    ctx.setLineWidth(6)
    ctx.addPath(
        CGPath(
            roundedRect: content.insetBy(dx: 3, dy: 3), cornerWidth: radius - 3,
            cornerHeight: radius - 3, transform: nil))
    ctx.strokePath()

    // Copper glyph, drawn twice for a subtle gradient (light on top).
    let glyphFrame = CGRect(x: 512 - 220, y: 512 - 220, width: 440, height: 440)
    drawGlyph(
        ctx, frame: glyphFrame, thickness: 58, cornerLength: 132, dotRadius: 66,
        stroke: color(0xF08B64), fill: color(0xFFB08F))

    savePNG(ctx, "captura-icon-1024.png")
}

// ---- Menu-bar template icon (18pt @1x and @2x, black + alpha only) ----
for (scale, name) in [(1, "tray.png"), (2, "tray@2x.png")] {
    let size = 18 * scale
    let ctx = makeContext(size)
    let s = CGFloat(scale)
    let inset: CGFloat = 2.5 * s
    let frame = CGRect(
        x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
    drawGlyph(
        ctx, frame: frame, thickness: 1.6 * s, cornerLength: 4.4 * s, dotRadius: 2.1 * s,
        stroke: color(0x000000), fill: color(0x000000))
    savePNG(ctx, name)
}
