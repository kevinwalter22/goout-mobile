#!/usr/bin/env node
/**
 * Generate Euda app icons from the source logo (euda.png).
 *
 * Produces:
 *   assets/images/icon.png               — 1024x1024 iOS/main icon (dark bg + logo)
 *   assets/images/favicon.png             — 48x48 web favicon
 *   assets/images/splash-icon.png         — splash screen logo (purple on transparent)
 *   assets/images/android-icon-foreground.png  — adaptive icon foreground
 *   assets/images/android-icon-background.png  — adaptive icon background (solid dark)
 *   assets/images/android-icon-monochrome.png  — adaptive icon monochrome
 *   assets/appstore/icon-1024.png         — App Store submission copy
 *
 * Usage: node scripts/generateIcons.js
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const IMAGES = path.join(ROOT, "assets", "images");
const APPSTORE = path.join(ROOT, "assets", "appstore");
const LOGO = path.join(IMAGES, "euda.png");

// Brand colors
const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 }; // #FFFFFF — white
const DARK_BG = { r: 17, g: 17, b: 17, alpha: 1 }; // #111111 — near-black
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Remove white background from the logo, producing transparent PNG.
 * Uses pixel-level processing: white-ish pixels → transparent,
 * with smooth alpha for anti-aliased edges.
 */
async function makeTransparentLogo() {
  const { data, info } = await sharp(LOGO)
    .trim()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);

  for (let i = 0; i < info.width * info.height; i++) {
    const si = i * 4;
    const r = data[si],
      g = data[si + 1],
      b = data[si + 2],
      a = data[si + 3];

    // Luminance of the pixel
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Alpha: dark (text) → 255, white (bg) → 0
    // Smoothly transition for anti-aliased edges
    let newAlpha;
    if (lum > 250) {
      newAlpha = 0; // pure white → fully transparent
    } else if (lum > 200) {
      // transition zone: 200-250 luminance → 255-0 alpha
      newAlpha = Math.round(((250 - lum) / 50) * 255);
    } else {
      newAlpha = Math.min(a, 255); // text pixels keep full alpha
    }

    out[si] = r;
    out[si + 1] = g;
    out[si + 2] = b;
    out[si + 3] = newAlpha;
  }

  return { buffer: out, width: info.width, height: info.height };
}

/**
 * Create a solid-color square canvas.
 */
function solidSquare(size, color) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: color },
  })
    .png()
    .toBuffer();
}

/**
 * Resize logo to fit within maxW x maxH, return buffer + metadata.
 */
async function resizeLogo(pngBuf, maxW, maxH) {
  const resized = await sharp(pngBuf)
    .resize(maxW, maxH, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return { buffer: resized, width: meta.width, height: meta.height };
}

/**
 * Composite a logo buffer centered on a background.
 */
async function compositeIcon(bgBuf, logoBuf, canvasSize, logoW, logoH) {
  const left = Math.round((canvasSize - logoW) / 2);
  const top = Math.round((canvasSize - logoH) / 2);

  return sharp(bgBuf)
    .composite([{ input: logoBuf, left, top }])
    .png()
    .toBuffer();
}

/**
 * Convert colored logo to white silhouette (for Android monochrome).
 */
async function makeWhiteSilhouette(pngBuf) {
  const { data, info } = await sharp(pngBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const si = i * 4;
    out[si] = 255; // R
    out[si + 1] = 255; // G
    out[si + 2] = 255; // B
    out[si + 3] = data[si + 3]; // preserve alpha
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function main() {
  fs.mkdirSync(APPSTORE, { recursive: true });

  console.log("Extracting transparent logo from euda.png...");
  const { buffer: rawPixels, width: tw, height: th } =
    await makeTransparentLogo();

  // Convert raw pixel buffer to PNG for further processing
  const transparentPng = await sharp(rawPixels, {
    raw: { width: tw, height: th, channels: 4 },
  })
    .png()
    .toBuffer();

  console.log(`  Trimmed logo: ${tw}x${th}`);

  // ── iOS / Main App Icon (1024x1024) ──────────────────────────
  const ICON = 1024;
  // Logo fills ~75% width for a bolder look, white background
  const { buffer: iconLogo, width: ilW, height: ilH } = await resizeLogo(
    transparentPng,
    Math.round(ICON * 0.75),
    Math.round(ICON * 0.36)
  );
  const whiteBg = await solidSquare(ICON, WHITE_BG);
  const appIcon = await compositeIcon(whiteBg, iconLogo, ICON, ilW, ilH);

  await sharp(appIcon).toFile(path.join(IMAGES, "icon.png"));
  await sharp(appIcon).toFile(path.join(APPSTORE, "icon-1024.png"));
  console.log("  ✓ icon.png (1024x1024)");
  console.log("  ✓ appstore/icon-1024.png");

  // ── Favicon (48x48) ──────────────────────────────────────────
  await sharp(appIcon).resize(48, 48).toFile(path.join(IMAGES, "favicon.png"));
  console.log("  ✓ favicon.png (48x48)");

  // ── Splash Icon (purple logo on transparent) ─────────────────
  // Expo splash plugin composites this onto a solid bg color
  const splashLogo = await sharp(transparentPng)
    .resize(480, null, { fit: "inside" })
    .png()
    .toFile(path.join(IMAGES, "splash-icon.png"));
  console.log("  ✓ splash-icon.png");

  // ── Android Adaptive Icon ────────────────────────────────────
  // 108dp canvas, 72dp safe zone (66.7%). Logo sized to fit safely.
  const ANDROID = 1024;
  const safeZone = Math.round(ANDROID * 0.667);
  const { buffer: androidLogo, width: alW, height: alH } = await resizeLogo(
    transparentPng,
    Math.round(safeZone * 0.82),
    Math.round(safeZone * 0.40)
  );

  // Foreground: logo on transparent
  const transparentBg = await solidSquare(ANDROID, TRANSPARENT);
  const fgIcon = await compositeIcon(transparentBg, androidLogo, ANDROID, alW, alH);
  await sharp(fgIcon).toFile(path.join(IMAGES, "android-icon-foreground.png"));
  console.log("  ✓ android-icon-foreground.png");

  // Background: solid white
  await sharp(await solidSquare(ANDROID, WHITE_BG)).toFile(
    path.join(IMAGES, "android-icon-background.png")
  );
  console.log("  ✓ android-icon-background.png");

  // Monochrome: white silhouette of logo on transparent
  const whiteLogo = await makeWhiteSilhouette(androidLogo);
  const monoIcon = await compositeIcon(transparentBg, whiteLogo, ANDROID, alW, alH);
  await sharp(monoIcon).toFile(
    path.join(IMAGES, "android-icon-monochrome.png")
  );
  console.log("  ✓ android-icon-monochrome.png");

  console.log("\nAll icons generated successfully!");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
