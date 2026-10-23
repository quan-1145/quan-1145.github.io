/**
 * core.js — pure ASCII pipeline (no DOM, no dependencies, unit-testable in Node).
 *
 *   source RGBA -> optional per-channel LUT -> BT.601 luminance
 *               -> ramp index (darkest glyph .. brightest glyph) + packed colour
 *
 * Everything here is geometry and arithmetic only: the browser side lives in
 * renderer.js and app.js.
 */

/* ITU-R BT.601 luminance weights. The sum is 1, so white maps to 255. */
const WR = 0.299;
const WG = 0.587;
const WB = 0.114;

/**
 * Built-in ramps: index 0 is the darkest glyph (looks empty), the last entry
 * the brightest. buildRamp() removes duplicate characters.
 */
export const CHARSETS = Object.freeze({
  classic: Object.freeze({ name: 'classic  .:-=+*#%@', chars: ' .:-=+*#%@' }),
  dense: Object.freeze({
    name: 'dense  69 levels',
    chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  }),
  blocks: Object.freeze({ name: 'blocks  ░▒▓█', chars: ' ░▒▓█' }),
  shade: Object.freeze({ name: 'shade  ▁▂▃▄▅▆▇█', chars: ' ▁▂▃▄▅▆▇█' }),
  digital: Object.freeze({ name: 'digital  .123456789', chars: ' .123456789' }),
  minimal: Object.freeze({ name: 'minimal  .:*#', chars: ' .:*#' }),
});

export const DEFAULT_CHARSET = 'classic';

/** Advance-width / font-size ratio of a monospace cell; measured at runtime. */
export const DEFAULT_CHAR_ASPECT = 0.6;

/** Numeric clamp; NaN/invalid input becomes `lo`. */
export function clamp(v, lo, hi) {
  const x = Number(v);
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

/** Single-channel clamp that also swallows NaN. */
function channel(v) {
  const x = Number(v);
  return x > 0 ? (x < 255 ? x : 255) : 0;
}

/** Per-pixel luminance, 0..255 (ITU-R BT.601). */
export function luminance255(r, g, b) {
  return WR * channel(r) + WG * channel(g) + WB * channel(b);
}

/**
 * Ramp for a charset key or a custom string: duplicate characters are dropped
 * (they would collapse several brightness bands into one glyph), optionally
 * reversed to invert dark/bright. Never returns an empty string.
 */
export function buildRamp(charsetKey, customCharset, invert) {
  const raw = typeof customCharset === 'string' && customCharset.length > 0
    ? customCharset
    : (CHARSETS[charsetKey] || CHARSETS[DEFAULT_CHARSET]).chars;
  const seen = new Set();
  let out = '';
  for (const ch of raw) {
    if (!seen.has(ch)) {
      seen.add(ch);
      out += ch;
    }
  }
  if (out.length === 0) out = CHARSETS[DEFAULT_CHARSET].chars;
  return invert ? [...out].reverse().join('') : out;
}

/**
 * Per-channel lookup table for brightness / contrast / gamma.
 * brightness ∈ [-1, 1], contrast ∈ [0, 2], gamma > 0 (gam > 1 lifts shadows).
 */
export function buildChannelLUT(brightness = 0, contrast = 1, gamma = 1) {
  const lut = new Uint8ClampedArray(256);
  const b = Number.isFinite(brightness) ? brightness : 0;
  const c = Number.isFinite(contrast) ? contrast : 1;
  const g = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
  const invG = 1 / g;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = (v - 0.5) * c + 0.5 + b;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    if (invG !== 1) v = Math.pow(v, invG);
    lut[i] = Math.round(v * 255);
  }
  return lut;
}

/* Identity LUT reused by mapFrame when the caller passes none. */
const IDENTITY_LUT = buildChannelLUT();

/**
 * Rows that keep one cell's aspect ratio at `charAspect`:
 *
 *   cellW / cellH = charAspect  and  cellW = canvasW / cols, cellH = canvasH / rows
 *   => rows = cols * (canvasH / canvasW) * charAspect
 *
 * A 16:9 box, 120 cols, 0.6 -> 120 * 0.5625 * 0.6 = 40.5 -> 41 rows.
 * Always an integer in 1..500.
 */
export function computeRowsForCols(cols, canvasW, canvasH, charAspect = DEFAULT_CHAR_ASPECT) {
  const c = Number(cols) > 0 ? Number(cols) : 1;
  const aspect = Number(charAspect) > 0 ? Number(charAspect) : DEFAULT_CHAR_ASPECT;
  const W = Number(canvasW);
  const H = Number(canvasH);
  if (!(W > 0) || !(H > 0)) return clamp(Math.round(c * 0.5), 1, 500);
  return clamp(Math.round(c * (H / W) * aspect), 1, 500);
}

/** Grid geometry: cols/rows -> pixel size of one cell. */
export function computeGrid({ canvasW, canvasH, cols, rows, autoRows = true, charAspect } = {}) {
  const c = clamp(Math.round(Number(cols) || 1), 1, 500);
  const r = autoRows
    ? computeRowsForCols(c, canvasW, canvasH, charAspect)
    : clamp(Math.round(Number(rows) || 1), 1, 500);
  const W = Number(canvasW) > 0 ? Number(canvasW) : c;
  const H = Number(canvasH) > 0 ? Number(canvasH) : r;
  return { cols: c, rows: r, cellW: W / c, cellH: H / r };
}

/** Frame storage: glyph index per cell + packed 0xRRGGBB colour per cell. */
export function createFrameBuffer(cols, rows) {
  const c = clamp(Math.round(Number(cols) || 1), 1, 500);
  const r = clamp(Math.round(Number(rows) || 1), 1, 500);
  return {
    cols: c,
    rows: r,
    rampIndex: new Uint8Array(c * r),
    packed: new Uint32Array(c * r),
  };
}

/**
 * Map an RGBA source image (one pixel per cell) into `fb`.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba cols*rows*4 bytes
 * @param {object} fb   createFrameBuffer() result, mutated in place
 * @param {object} o    { ramp, lut, colorMode: 'color'|'gray'|'mono', monoPacked }
 * @returns {object} fb
 */
export function mapFrame(rgba, fb, o = {}) {
  if (!fb || !rgba || !(fb.cols > 0) || !(fb.rows > 0)) return fb;
  const n = fb.cols * fb.rows;
  if (rgba.length < n * 4) return fb; // incomplete source data: refuse, keep fb intact

  const ramp = typeof o.ramp === 'string' && o.ramp.length > 0
    ? o.ramp
    : CHARSETS[DEFAULT_CHARSET].chars;
  const lut = o.lut && o.lut.length >= 256 ? o.lut : IDENTITY_LUT;
  const mode = o.colorMode === 'gray' || o.colorMode === 'mono' ? o.colorMode : 'color';
  const mono = (o.monoPacked >>> 0) || 0;

  const last = ramp.length - 1; // a single-glyph ramp gives last = 0 -> index 0
  const scale = last / 255;
  const idx = fb.rampIndex;
  const packed = fb.packed;

  for (let i = 0; i < n; i++) {
    const p = i << 2;
    const r = lut[rgba[p]];
    const g = lut[rgba[p + 1]];
    const b = lut[rgba[p + 2]];
    const y = WR * r + WG * g + WB * b;

    let k = (y * scale + 0.5) | 0;
    if (k > last) k = last; // rounding guard at y === 255
    idx[i] = k;

    if (mode === 'mono') {
      packed[i] = mono;
    } else if (mode === 'gray') {
      const v = y < 0 ? 0 : y > 255 ? 255 : y | 0;
      packed[i] = (v << 16) | (v << 8) | v;
    } else {
      packed[i] = (r << 16) | (g << 8) | b;
    }
  }
  return fb;
}

/** Frame buffer -> one string per row. */
export function frameToLines(fb, ramp) {
  if (!fb || !(fb.cols > 0) || !(fb.rows > 0)) return [];
  const glyphs = typeof ramp === 'string' && ramp.length > 0
    ? ramp
    : CHARSETS[DEFAULT_CHARSET].chars;
  const { cols, rows, rampIndex } = fb;
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    let s = '';
    for (let c = 0; c < cols; c++) s += glyphs[rampIndex[base + c]];
    out[r] = s;
  }
  return out;
}

/** Frame buffer -> text with rows joined by '\n'. */
export function frameToText(fb, ramp) {
  return frameToLines(fb, ramp).join('\n');
}

/**
 * Rect that fits a vw × vh source into a w × h box.
 * fit: contain (letterbox) | cover (crop) | stretch (distort).
 * Both arguments must be in the same coordinate space.
 */
export function fitRect(vw, vh, w, h, fit = 'contain') {
  const W = Number(w) > 0 ? Number(w) : 0;
  const H = Number(h) > 0 ? Number(h) : 0;
  if (fit === 'stretch') return { x: 0, y: 0, w: W, h: H };
  const VW = Number(vw) > 0 ? Number(vw) : 0;
  const VH = Number(vh) > 0 ? Number(vh) : 0;
  if (!VW || !VH) return { x: 0, y: 0, w: W, h: H };
  const s = fit === 'cover' ? Math.max(W / VW, H / VH) : Math.min(W / VW, H / VH);
  const dw = VW * s;
  const dh = VH * s;
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
}

/**
 * Fit a source rect into a cols × rows sample canvas, doing the fit in display
 * space first: cells are not square (a cell is ~charAspect as wide as tall), so
 * a cols × rows box and the rectangle it occupies on screen have different
 * proportions. `displayAspect` = displayed width / height of the grid
 * (defaults to cols / rows).
 */
export function fitRectToGrid(vw, vh, cols, rows, fit, displayAspect) {
  const C = Number(cols) > 0 ? Number(cols) : 1;
  const R = Number(rows) > 0 ? Number(rows) : 1;
  const boxW = Number(displayAspect) > 0 ? Number(displayAspect) : C / R;
  const r = fitRect(vw, vh, boxW, 1, fit);
  const kx = C / boxW;
  const ky = R;
  return { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky };
}

/** Packed 0xRRGGBB -> '#rrggbb'. */
export function hexString(packed) {
  const p = (Number(packed) || 0) & 0xffffff;
  return '#' + ((p | 0x1000000).toString(16).slice(1));
}
