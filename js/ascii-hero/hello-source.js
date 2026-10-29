/**
 * hello-source.js — the animated default: a large two-line "Hello, World!" in ASCII.
 *
 * The target canvas is the sampling grid (one pixel per character cell), so
 * everything is drawn in display space: the cells are not square on screen,
 * therefore x is pre-stretched by 1 / cellAspect so the letters keep their
 * normal proportions once the grid is stretched back onto the monitor.
 *
 * The two-line block is centred horizontally and at 43% of the height (the
 * bottom of the panel carries the command-line overlay), it is the brightest
 * thing on the canvas, and the background stays almost entirely black so the
 * glyph grid is never noisy. Motion comes from the words themselves: a
 * travelling specular sweep, a gentle brightness breath and the blinking caret.
 */

const DEFAULT_FONT = '"Source Code Pro", "Cascadia Mono", "JetBrains Mono", Consolas, Monaco, monospace';
const LINES = ['Hello,', 'World!'];
const SWEEP_PERIOD = 4.6;   // seconds per highlight sweep
const BREATHE_PERIOD = 3.2; // seconds per brightness breath
const BLINK_PERIOD = 1.06;  // seconds per caret blink cycle
const MAX_TICK_MS = 100;    // never jump more than one blink after a stall

const WIDTH_TARGET = 0.88;  // widest line + caret as a fraction of the panel width
const HEIGHT_CAP = 0.50;    // two-line block as a fraction of the panel height
const LINE_HEIGHT = 1.02;   // baseline distance, in font sizes
const CENTER_Y_RATIO = 0.43;
const CURSOR_W = 0.18;      // thin caret width, in font sizes
const CURSOR_H = 0.72;      // caret height, in font sizes
const CURSOR_GAP = 0.08;    // gap between the last glyph and the caret
const EDGE_MARGIN = 0.01;   // keeps the caret off the canvas edge

function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return parts.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))));
    }
  }
  return null;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgba(c, alpha) {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export class HelloSource {
  constructor({ fontFamily, accent = '#00ff00', secondary = '#44aaff' } = {}) {
    this.kind = 'hello';
    this.fontFamily = fontFamily || DEFAULT_FONT;
    this.accent = accent || '#00ff00';
    this.secondary = secondary || '#44aaff';
    this._accentRgb = parseColor(this.accent) || [0, 255, 0];
    this._secondaryRgb = parseColor(this.secondary) || [68, 170, 255];
    this._clock = 0;
    this._layout = null;
    this._layoutKey = '';
    this._fontEpoch = 0;

    // A late webfont changes the measured advance; drop the cached layout once.
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts && fonts.ready && typeof fonts.ready.then === 'function') {
      fonts.ready
        .then(() => {
          this._fontEpoch += 1;
          this._layoutKey = '';
        })
        .catch(() => {});
    }
  }

  get width() {
    return 1280;
  }

  get height() {
    return 720;
  }

  get ready() {
    return true;
  }

  get time() {
    return this._clock;
  }

  setAccent(color) {
    if (typeof color !== 'string' || color.length === 0) return;
    this.accent = color;
    const rgb = parseColor(color);
    if (rgb) this._accentRgb = rgb;
    this._layoutKey = '';
  }

  /** Advance the internal clock; one step is clamped so tabs/timers cannot jump it. */
  tick(dtMs) {
    const dt = Number.isFinite(dtMs) ? Math.min(Math.max(dtMs, 0), MAX_TICK_MS) : 0;
    this._clock += dt / 1000;
  }

  /** Draw one frame into the cols x rows sampling canvas. */
  drawInto(ctx, w, h, opts = {}) {
    if (!ctx || typeof ctx.fillRect !== 'function' || !(w >= 1) || !(h >= 1)) return false;

    const cols = Math.max(1, Math.round(w));
    const rows = Math.max(1, Math.round(h));
    const displayAspect = opts && opts.displayAspect > 0 ? opts.displayAspect : cols / rows;
    const cellAspect = displayAspect * (rows / cols);
    const ax = 1 / Math.max(0.2, Math.min(5, cellAspect));
    const boxW = cols / ax;

    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cols, rows);

      ctx.save();
      ctx.scale(ax, 1);
      const layout = this._layoutFor(ctx, boxW, rows);
      this._drawBackground(ctx, boxW, rows, layout);
      this._drawText(ctx, layout, boxW);
      ctx.restore();
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Fit the two lines as one block: the widest line (plus the cursor) targets
   * 82% of the width, the block targets 46% of the height, and the cursor must
   * stay inside the canvas. Scale down whichever limit is tightest.
   */
  _layoutFor(ctx, boxW, h) {
    const key = `${boxW.toFixed(2)}|${h}|${this._fontEpoch}|${this.accent}`;
    if (this._layout && this._layoutKey === key) return this._layout;

    const family = this.fontFamily;
    const PROBE = 64;
    ctx.font = `700 ${PROBE}px ${family}`;
    const probeA = ctx.measureText(LINES[0]);
    const probeB = ctx.measureText(LINES[1]);
    const widthPerEm = Math.max(probeA.width, probeB.width, 1) / PROBE;
    const ascentRatio =
      Math.max(probeA.actualBoundingBoxAscent || 0, probeB.actualBoundingBoxAscent || 0) / PROBE || 0.72;
    const descentRatio =
      Math.max(probeA.actualBoundingBoxDescent || 0, probeB.actualBoundingBoxDescent || 0) / PROBE || 0.2;
    const glyphRatio = ascentRatio + descentRatio;

    const widthLimit = (WIDTH_TARGET * boxW) / widthPerEm;
    const heightLimit = (HEIGHT_CAP * h) / (LINE_HEIGHT + glyphRatio);
    const cursorLimit =
      (boxW * (0.5 - EDGE_MARGIN)) / (widthPerEm / 2 + CURSOR_GAP + CURSOR_W);
    let fs = Math.min(widthLimit, heightLimit, cursorLimit, h * 0.8);
    fs = Math.max(0.5, fs);

    ctx.font = `700 ${fs}px ${family}`;
    const measured = LINES.map((text) => {
      const m = ctx.measureText(text);
      return { text, width: m.width > 0 ? m.width : widthPerEm * fs };
    });

    const lineGap = LINE_HEIGHT * fs;
    const ascent = ascentRatio * fs;
    const descent = descentRatio * fs;
    // Two baselines around the target centre, then shift so the glyph block
    // itself (not the baselines) is centred at CENTER_Y_RATIO.
    const provisional = measured.map((line, index) => ({
      text: line.text,
      width: line.width,
      x: (boxW - line.width) / 2,
      y: h * CENTER_Y_RATIO + (index === 0 ? -lineGap / 2 : lineGap / 2),
    }));
    const blockHeight = lineGap + ascent + descent;
    const blockCenter = (provisional[0].y - ascent + provisional[provisional.length - 1].y + descent) / 2;
    const shift = h * CENTER_Y_RATIO - blockCenter;
    for (let i = 0; i < provisional.length; i += 1) provisional[i].y += shift;

    const lines = provisional;
    const last = lines[lines.length - 1];
    const cursorW = Math.max(1, CURSOR_W * fs);
    const cursorH = Math.max(1, Math.min(h * 0.32, CURSOR_H * fs));
    const maxCursorX = Math.max(0, boxW - cursorW - EDGE_MARGIN * boxW);
    const cursorX = Math.min(last.x + last.width + CURSOR_GAP * fs, maxCursorX);

    let blockLeft = Infinity;
    let blockRight = -Infinity;
    for (let i = 0; i < lines.length; i += 1) {
      blockLeft = Math.min(blockLeft, lines[i].x);
      blockRight = Math.max(blockRight, lines[i].x + lines[i].width);
    }

    const layout = {
      fs,
      lines,
      lineGap,
      blockLeft,
      blockRight,
      blockWidth: Math.max(1, blockRight - blockLeft),
      blockTop: h * CENTER_Y_RATIO - blockHeight / 2,
      blockBottom: h * CENTER_Y_RATIO + blockHeight / 2,
      cursorX,
      cursorY: last.y,
      cursorW,
      cursorH,
    };
    this._layout = layout;
    this._layoutKey = key;
    return layout;
  }

  _drawBackground(ctx, boxW, h, layout) {
    const t = this._clock;
    const [ar, ag, ab] = this._accentRgb;
    const [sr, sg, sb] = this._secondaryRgb;

    // Nothing is painted behind the glyphs: one drifting dot inside an "o"
    // would close its counter once the frame is downsampled to one pixel per cell.
    const textTop = Math.max(0, layout.blockTop - 1);
    const textBottom = Math.min(h, layout.blockBottom + 1);

    // A faint breathing glow around the words. Kept under the ramp threshold:
    // the panel must read black, the headline is the only bright thing.
    const glow = 0.035 + 0.015 * (0.5 + 0.5 * Math.sin((t / 5.3) * Math.PI * 2));
    const cx = boxW * 0.5;
    const cy = h * CENTER_Y_RATIO;
    const radius = Math.max(boxW * 0.45, h * 0.55, 2);
    const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    radial.addColorStop(0, rgba([sr, sg, sb], glow.toFixed(3)));
    radial.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, boxW, h);

    // Very faint drifting scanlines: barely one brightness step after quantisation,
    // so they read as texture, never as bright rules.
    const step = 5;
    const offset = ((t * 0.35) % step + step) % step;
    for (let y = offset - step; y < h; y += step) {
      const yy = Math.round(y);
      if (yy < 0 || yy >= h) continue;
      if (yy >= textTop && yy <= textBottom) continue;
      const a = 0.02 + 0.015 * (0.5 + 0.5 * Math.sin(yy * 0.4 - t * 0.9));
      ctx.fillStyle = rgba([ar, ag, ab], a.toFixed(3));
      ctx.fillRect(0, yy, boxW, 1);
    }

    // One slow vertical light band, also below the ramp threshold.
    const bandX = ((((t * 0.04) % 1) + 1) % 1) * (boxW * 1.3) - boxW * 0.15;
    const band = ctx.createLinearGradient(bandX - boxW * 0.12, 0, bandX + boxW * 0.12, 0);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.5, rgba([ar, ag, ab], 0.03));
    band.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = band;
    if (textTop > 0) ctx.fillRect(0, 0, boxW, textTop);
    if (textBottom < h) ctx.fillRect(0, textBottom, boxW, h - textBottom);
  }

  _drawText(ctx, layout, boxW) {
    const t = this._clock;
    ctx.font = `700 ${layout.fs}px ${this.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Bright accent, pulled towards white so it lands on #/@ after the ramp:
    // the words must stay the brightest thing on the canvas.
    const base = mix(this._accentRgb, [255, 255, 255], 0.6);
    const breathe = 0.96 + 0.04 * Math.sin((t / BREATHE_PERIOD) * Math.PI * 2);
    ctx.fillStyle = rgba(base, breathe.toFixed(3));
    for (let i = 0; i < layout.lines.length; i += 1) {
      const line = layout.lines[i];
      ctx.fillText(line.text, line.x, line.y);
    }

    // Travelling specular highlight across both lines.
    const band = Math.max(layout.fs * 0.85, 1.2);
    const phase = (((t / SWEEP_PERIOD) % 1) + 1) % 1;
    const sweepX = layout.blockLeft - band + phase * (layout.blockWidth + band * 2);
    const core = mix(this._accentRgb, [255, 255, 255], 0.92);
    const sweep = ctx.createLinearGradient(sweepX - band, 0, sweepX + band, 0);
    sweep.addColorStop(0, rgba(core, 0));
    sweep.addColorStop(0.45, rgba(core, 0.85));
    sweep.addColorStop(0.55, rgba(core, 0.85));
    sweep.addColorStop(1, rgba(core, 0));
    ctx.fillStyle = sweep;
    for (let i = 0; i < layout.lines.length; i += 1) {
      const line = layout.lines[i];
      ctx.fillText(line.text, line.x, line.y);
    }

    // Blinking thin caret right after the last glyph of "World!", sitting on the
    // baseline so it lines up with the letters instead of hanging under them.
    const blink = (((t / BLINK_PERIOD) % 1) + 1) % 1;
    if (blink >= 0.52) return;
    const x = Math.max(0, Math.min(layout.cursorX, boxW - layout.cursorW));
    if (x + layout.cursorW > boxW + 0.5) return;
    ctx.fillStyle = rgba(mix(this._accentRgb, [255, 255, 255], 0.7), 0.95);
    ctx.fillRect(x, layout.cursorY - layout.cursorH, layout.cursorW, layout.cursorH);
  }
}
