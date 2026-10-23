/**
 * renderer.js — canvas output backend for the ASCII hero.
 *
 * Layered composite (the fast path, ported from the reference implementation):
 *   1. colour layer: a cols × rows offscreen canvas, one pixel per cell,
 *      written with putImageData
 *   2. glyph layer: an offscreen canvas at backing-store size, white glyphs on
 *      a transparent background (fillStyle never changes)
 *   3. main canvas: draw the colour layer scaled up with smoothing off, then
 *      mask it with the glyph alpha ('destination-in') — the canvas stays
 *      transparent between glyphs, so the hero's CSS background (the page
 *      colour) shows through instead of a hard-coded black rectangle.
 *
 * That avoids one fillStyle change per glyph, which is the expensive part of
 * the naive per-cell renderer.
 */

import { DEFAULT_CHAR_ASPECT } from './core.js';

/**
 * Measure the advance-width / font-size ratio of a monospace font by drawing
 * ten 'M' at 100px. Falls back to DEFAULT_CHAR_ASPECT outside the browser or
 * when the measurement is implausible.
 */
export function measureAdvanceRatio(fontFamily = 'monospace') {
  if (typeof document === 'undefined') return DEFAULT_CHAR_ASPECT;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return DEFAULT_CHAR_ASPECT;
    ctx.font = `100px ${fontFamily || 'monospace'}`;
    const ratio = ctx.measureText('MMMMMMMMMM').width / 10 / 100;
    return ratio > 0.01 && ratio < 3 ? ratio : DEFAULT_CHAR_ASPECT;
  } catch {
    return DEFAULT_CHAR_ASPECT;
  }
}

/** Font size whose glyph advance fills `cellW` CSS pixels. */
export function fontSizeForCell(cellW, advanceRatio) {
  const w = Number(cellW);
  if (!(w > 0)) return 1;
  const ratio = Number(advanceRatio) > 0.01 && Number(advanceRatio) < 3
    ? Number(advanceRatio)
    : DEFAULT_CHAR_ASPECT;
  return Math.max(1, w / ratio);
}

export class CanvasRenderer {
  /** @param {HTMLCanvasElement} canvas visible hero canvas */
  constructor(canvas) {
    this.canvas = canvas || null;
    // Alpha is required: the hero background (page colour) lives in CSS behind
    // the canvas, and the space between glyphs must stay transparent.
    this.ctx = canvas && typeof canvas.getContext === 'function'
      ? canvas.getContext('2d')
      : null;
    this.colorCanvas = null;
    this.colorCtx = null;
    this.glyphCanvas = null;
    this.glyphCtx = null;
    this.image = null;
  }

  /** Lazily create the two offscreen canvases (document may be absent). */
  _ensureLayers() {
    if (this.colorCanvas || typeof document === 'undefined') return;
    this.colorCanvas = document.createElement('canvas');
    this.colorCtx = this.colorCanvas.getContext('2d', { alpha: false });
    // The glyph layer must keep its alpha channel: an opaque canvas makes
    // Chrome use LCD subpixel antialiasing, whose red/cyan fringes would be
    // multiplied into the final image.
    this.glyphCanvas = document.createElement('canvas');
    this.glyphCtx = this.glyphCanvas.getContext('2d');
  }

  /** Backing-store size, in device pixels. */
  resize(w, h) {
    if (!this.ctx) return;
    this._ensureLayers();
    const W = Math.max(1, Math.round(Number(w) || 0));
    const H = Math.max(1, Math.round(Number(h) || 0));
    this.canvas.width = W;
    this.canvas.height = H;
    if (this.glyphCanvas) {
      this.glyphCanvas.width = W;
      this.glyphCanvas.height = H;
    }
    this.ctx.imageSmoothingEnabled = false;
    if (this.glyphCtx) {
      this.glyphCtx.textAlign = 'center';
      this.glyphCtx.textBaseline = 'middle';
    }
  }

  /**
   * Paint one frame.
   * @param {object} fb   frame buffer from core.createFrameBuffer/mapFrame
   * @param {object} o    { ramp, cellW, cellH, font }
   */
  draw(fb, o) {
    o = o || {};
    const ctx = this.ctx;
    if (!ctx || !fb || !(fb.cols > 0) || !(fb.rows > 0)) return;

    this._ensureLayers();
    const colorCtx = this.colorCtx;
    const glyphCtx = this.glyphCtx;
    if (!colorCtx || !glyphCtx) return;

    const cols = fb.cols;
    const rows = fb.rows;
    const cellW = Number(o.cellW) > 0 ? Number(o.cellW) : 1;
    const cellH = Number(o.cellH) > 0 ? Number(o.cellH) : 1;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // 1. Colour layer: one opaque pixel per cell.
    if (this.colorCanvas.width !== cols || this.colorCanvas.height !== rows || !this.image) {
      this.colorCanvas.width = cols;
      this.colorCanvas.height = rows;
      this.image = colorCtx.createImageData(cols, rows);
      const a = this.image.data;
      for (let i = 3; i < a.length; i += 4) a[i] = 255; // alpha once
    }
    const d = this.image.data;
    const packed = fb.packed;
    const n = Math.min(cols * rows, d.length >> 2);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const p = packed[i];
      d[j] = (p >>> 16) & 255;
      d[j + 1] = (p >>> 8) & 255;
      d[j + 2] = p & 255;
    }
    colorCtx.putImageData(this.image, 0, 0);

    // 2. Glyph layer: transparent background + white glyphs (an alpha mask).
    //    Re-set the text state in case something resized the canvas since resize().
    const g = glyphCtx;
    const ramp = typeof o.ramp === 'string' && o.ramp.length > 0 ? o.ramp : ' ';
    const font = typeof o.font === 'string' && o.font.length > 0
      ? o.font
      : `${Math.max(1, Math.round(cellH))}px monospace`;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = font;

    const idx = fb.rampIndex;
    const spaceIndex = ramp.indexOf(' ');
    for (let r = 0; r < rows; r++) {
      const y = r * cellH + cellH * 0.5;
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        const k = idx[base + c];
        if (k === spaceIndex) continue; // spaces need no glyph
        g.fillText(ramp[k], c * cellW + cellW * 0.5, y);
      }
    }

    // 3. Composite: colour cells masked by glyph coverage. Pixels between
    //    glyphs are cleared to transparent so the page background shows through.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.colorCanvas, 0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.glyphCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}
