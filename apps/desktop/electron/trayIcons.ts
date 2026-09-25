import { nativeImage, type NativeImage } from "electron";

// Tray and taskbar icons are drawn in code, so there are no per-platform image files to keep in sync.
// macOS gets black "template" glyphs that the menu bar recolours for light and dark mode; Windows
// gets coloured ones, since its tray does not recolour icons.

export type TrayState = "idle" | "running" | "attention";

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const COLORS: Record<TrayState, Rgb> = {
  idle: [138, 138, 138],
  running: [47, 125, 225],
  attention: [214, 69, 69],
};

/** Coverage of a disc of radius r at distance d from its centre, anti-aliased over one pixel. */
const disc = (r: number, d: number) => Math.min(1, Math.max(0, r - d + 0.5));

/** Alpha 0–1 for one pixel of a glyph: a ring when idle, a ring with a dot when running, a filled disc for attention. */
function glyphAlpha(state: TrayState, size: number, x: number, y: number): number {
  const c = size / 2;
  const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
  const outer = size * 0.42;
  if (state === "attention") return disc(outer, d);
  const ring = Math.min(disc(outer, d), 1 - disc(outer - size * 0.13, d));
  return state === "running" ? Math.max(ring, disc(size * 0.17, d)) : ring;
}

/** Premultiplied BGRA pixels, the layout nativeImage.createFromBitmap expects. */
function drawGlyph(state: TrayState, size: number, [r, g, b]: Rgb): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = glyphAlpha(state, size, x, y);
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(b * a);
      pixels[i + 1] = Math.round(g * a);
      pixels[i + 2] = Math.round(r * a);
      pixels[i + 3] = Math.round(255 * a);
    }
  }
  return pixels;
}

function glyphImage(state: TrayState, color: Rgb, template: boolean): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: drawGlyph(state, size, color) });
  }
  if (template) image.setTemplateImage(true);
  return image;
}

const cache = new Map<string, NativeImage>();

function cached(key: string, create: () => NativeImage): NativeImage {
  let image = cache.get(key);
  if (!image) cache.set(key, (image = create()));
  return image;
}

export function trayIcon(state: TrayState): NativeImage {
  const template = process.platform === "darwin";
  return cached(`tray:${state}`, () => glyphImage(state, template ? BLACK : COLORS[state], template));
}

/** Red dot laid over the Windows taskbar button while failed runs are unseen. */
export function attentionOverlay(): NativeImage {
  return cached("overlay", () => glyphImage("attention", COLORS.attention, false));
}
