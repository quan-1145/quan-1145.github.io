/**
 * perf.js — device-tier detection and the adaptive quality controller for the ASCII hero.
 *
 * Pure ESM: no DOM, no timers, no dependencies. Every decision is a function of the numbers
 * handed to it (including `now`), so the whole policy is deterministic and unit-testable in
 * Node — see tests/ascii-hero/unit-perf.test.mjs.
 *
 * The controller is a two-way governor. The reference player could only ever reduce resolution;
 * this one also climbs back up when the device turns out to have headroom:
 *
 *   render EMA > 80% of the frame budget   -> fewer columns (-15%), then a slower FPS step
 *   frame interval > 135% of the budget    -> slower FPS step (the browser cannot hit the target)
 *   render EMA < 45% for 3 evaluations     -> more columns (+10%), then a faster FPS step
 *
 * Evaluations run at most every 500 ms, every change is followed by 1200 ms of silence and the
 * first 400 ms of a session (or of a resize) are ignored, so start-up noise cannot flip quality
 * and the 0.8 / 0.45 hysteresis band keeps a borderline device from flapping.
 */

/** Target frame rates in order. Every fps value the controller reports comes from here. */
export const FPS_LADDER = Object.freeze([24, 30, 45, 60]);

/**
 * Per-tier starting point, caps and cell size. `cellPx` is the preferred CSS pixel size of one
 * character cell: smaller cells mean more columns for the same hero width, which is sharper but
 * more expensive. Weak devices get big cells, few columns and never more than 30 fps; strong
 * devices start at 45 fps with room to recover to 60.
 */
export const TIERS = Object.freeze({
  low: Object.freeze({
    tier: 'low', cellPx: 11, minCols: 24, maxCols: 64, initialFps: 24, maxFps: 30, maxDpr: 1,
  }),
  mid: Object.freeze({
    tier: 'mid', cellPx: 9, minCols: 32, maxCols: 110, initialFps: 30, maxFps: 45, maxDpr: 1.5,
  }),
  high: Object.freeze({
    tier: 'high', cellPx: 7, minCols: 40, maxCols: 200, initialFps: 45, maxFps: 60, maxDpr: 2,
  }),
});

/* Tier score cut-offs (see detectDeviceTier for the formula). */
const SCORE_HIGH = 58;
const SCORE_LOW = 30;
const MAX_CORES = 16;

/* Fallbacks used when the environment does not report a signal (e.g. Node, old browsers). */
const DEFAULT_WIDTH = 960;
const DEFAULT_CORES = 4;
const DEFAULT_MEMORY = 4;

/* Controller timing, in milliseconds. */
const WARMUP_MS = 400;
const WARMUP_FRAMES = 8;
const EVAL_INTERVAL_MS = 500;
const COOLDOWN_MS = 1200;

/* EMA weights: render cost is the signal we act on, so it reacts a little faster than frame time. */
const EMA_RENDER = 0.15;
const EMA_FRAME = 0.1;

/* Ratios relative to the frame budget (1000 / fps). */
const BUDGET_REDUCE = 0.8;
const BUDGET_RAISE = 0.45;
const FRAME_HARD = 1.35;
const FRAME_OK = 1.1;

/* Column steps and how many consecutive good evaluations are needed before raising. */
const COLS_DOWN = 0.85;
const COLS_UP = 1.1;
const RAISE_EVALS = 3;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampNum(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Columns that fit `width` CSS pixels at `cellPx` per cell, clamped to the tier's box. */
function colsForWidth(width, cellPx, minCols, maxCols) {
  const usable = finite(width) && width > 0 ? width : DEFAULT_WIDTH;
  return clampNum(Math.round(usable / cellPx), minCols, maxCols);
}

/** Index of the largest ladder value <= fps (0 when fps is below the ladder). */
function ladderIndex(fps) {
  let index = 0;
  for (let i = 0; i < FPS_LADDER.length; i++) {
    if (FPS_LADDER[i] <= fps) index = i;
  }
  return index;
}

/** Nearest ladder value at or below both fps and the tier cap. */
function ladderFps(fps, maxFps) {
  return FPS_LADDER[ladderIndex(Math.min(fps, maxFps))];
}

/** Next ladder value in `dir` (+1 up, -1 down); null when the step would leave the ladder or the cap. */
function stepFps(fps, dir, maxFps) {
  const index = ladderIndex(fps) + dir;
  if (index < 0 || index >= FPS_LADDER.length) return null;
  const next = FPS_LADDER[index];
  return dir > 0 && next > maxFps ? null : next;
}

/**
 * Merge a tier argument (a detectDeviceTier() result, a tier name, or a partial object) with the
 * built-in tier table. Unknown tiers fall back to `mid`; explicit numeric fields win over the
 * defaults so callers can tighten the cap (e.g. options.maxCols).
 */
function resolveSpec(tier) {
  if (typeof tier === 'string') return TIERS[tier] || TIERS.mid;
  const given = tier && typeof tier === 'object' ? tier : {};
  const base = TIERS[given.tier] || TIERS.mid;
  const pick = (key) => (finite(given[key]) ? given[key] : base[key]);
  const minCols = Math.max(1, Math.round(pick('minCols')));
  return {
    tier: base.tier,
    // A non-positive cell size would divide by zero; ignore it and keep the tier default.
    cellPx: pick('cellPx') > 0 ? pick('cellPx') : base.cellPx,
    minCols,
    // Callers may tighten maxCols (theme option); never let it fall below minCols.
    maxCols: Math.max(minCols, Math.round(pick('maxCols'))),
    initialFps: pick('initialFps'),
    maxFps: pick('maxFps'),
    initialCols: finite(given.initialCols) && given.initialCols > 0 ? given.initialCols : 0,
  };
}

/**
 * Describe the starting quality for a device.
 * @param {object} [env] browser signals; every field is optional and safe to get wrong
 * @returns {{tier: 'low'|'mid'|'high', score: number, reducedMotion: boolean,
 *            initialCols: number, maxCols: number, minCols: number,
 *            initialFps: number, maxFps: number, maxDpr: number, cellPx: number}}
 */
export function detectDeviceTier(env = {}) {
  const source = env && typeof env === 'object' ? env : {};
  const cores = finite(source.hardwareConcurrency)
    ? clampNum(source.hardwareConcurrency, 1, MAX_CORES)
    : DEFAULT_CORES;
  const memory = finite(source.deviceMemory) ? clampNum(source.deviceMemory, 0.5, 8) : DEFAULT_MEMORY;
  const dpr = finite(source.devicePixelRatio) && source.devicePixelRatio > 0
    ? source.devicePixelRatio
    : 1;
  const touch = Boolean(source.touch);
  const saveData = Boolean(source.saveData);
  const reducedMotion = Boolean(source.reducedMotion);

  // Cores dominate (they decide how much JS work fits in a frame); memory and DPR refine it;
  // touch, data-saver and reduced motion are user-facing hints that we should stay cheap.
  // A 4-core 4 GB HiDPI laptop must land on `mid`, a 2-core machine on `low`, an 8-core desktop
  // with 8 GB and a normal screen on `high`.
  let score = (cores / 8) * 36 + (memory / 4) * 18 - Math.max(0, dpr - 1) * 5;
  if (touch) score -= 8;
  if (saveData) score -= 20;
  if (reducedMotion) score -= 4;
  score = clampNum(score, 0, 100);

  // A data-saver setting is an explicit "keep it cheap" request, so it always lands on `low`.
  const tier = saveData || score < SCORE_LOW ? 'low' : score >= SCORE_HIGH ? 'high' : 'mid';
  const spec = TIERS[tier];
  const width = finite(source.width) && source.width > 0 ? source.width : DEFAULT_WIDTH;

  return {
    tier,
    score: Math.round(score * 10) / 10,
    reducedMotion,
    initialCols: colsForWidth(width, spec.cellPx, spec.minCols, spec.maxCols),
    maxCols: spec.maxCols,
    minCols: spec.minCols,
    initialFps: spec.initialFps,
    maxFps: spec.maxFps,
    maxDpr: spec.maxDpr,
    cellPx: spec.cellPx,
  };
}

/**
 * Adaptive quality governor: call observe() once per rendered frame, apply whatever change object
 * comes back, and call resize() whenever the hero's CSS box changes.
 */
export class QualityController {
  /**
   * @param {object} [options]
   * @param {object|string} [options.tier] detectDeviceTier() result (or a tier name)
   * @param {number} [options.widthHint] hero width in CSS pixels
   */
  constructor({ tier, widthHint } = {}) {
    this._spec = resolveSpec(tier);
    this._initial = {
      cols: this._initialCols(this._spec, widthHint),
      fps: ladderFps(this._spec.initialFps, this._spec.maxFps),
    };
    this.reset();
  }

  _initialCols(spec, widthHint) {
    if (finite(widthHint) && widthHint > 0) {
      return colsForWidth(widthHint, spec.cellPx, spec.minCols, spec.maxCols);
    }
    if (spec.initialCols > 0) {
      return clampNum(Math.round(spec.initialCols), spec.minCols, spec.maxCols);
    }
    return colsForWidth(DEFAULT_WIDTH, spec.cellPx, spec.minCols, spec.maxCols);
  }

  /**
   * Feed one rendered frame. Updates the EMAs on every call but only evaluates quality every
   * EVAL_INTERVAL_MS, after the warm-up and after the cooldown that follows any change.
   * @param {{renderMs: number, frameMs: number, now: number}} sample
   * @returns {null | {cols: number, fps: number, reason: string}}
   */
  observe(input) {
    const sample = input && typeof input === 'object' ? input : null;
    if (!sample) return null;
    const { renderMs, frameMs, now } = sample;
    if (!finite(now) || !finite(renderMs) || renderMs < 0) return null;

    // A fresh session (or a resize) starts a new warm-up and drops the stale signal.
    if (this._t0 === null || this._rewarm || now < this._t0) {
      this._t0 = now;
      this._lastEvalAt = now;
      this._rewarm = false;
      this._renderEma = 0;
      this._frameEma = 0;
    }
    this._frames++;
    this._renderEma = ema(this._renderEma, renderMs, EMA_RENDER);
    if (finite(frameMs) && frameMs > 0) this._frameEma = ema(this._frameEma, frameMs, EMA_FRAME);

    if (now - this._t0 < WARMUP_MS || this._frames < WARMUP_FRAMES) return null;
    if (now - this._lastEvalAt < EVAL_INTERVAL_MS) return null;
    this._lastEvalAt = now;
    if (now < this._cooldownUntil) return null;
    return this._evaluate(now);
  }

  _evaluate(now) {
    const budget = 1000 / this._fps;
    const render = this._renderEma;
    const frame = this._frameEma;
    const renderOver = render > budget * BUDGET_REDUCE;
    const frameOver = frame > 0 && frame > budget * FRAME_HARD;

    // Too slow: shrink the grid first (cheaper per frame), then fall back to a slower target fps.
    if (renderOver && this._cols > this._spec.minCols) {
      const cols = Math.max(this._spec.minCols, Math.round(this._cols * COLS_DOWN));
      if (cols < this._cols) return this._apply(now, cols, this._fps, 'reduce-cols');
    }
    // The hard case: rAF is handing out frames slower than we ask for, so the target is impossible.
    if (renderOver || frameOver) {
      const fps = stepFps(this._fps, -1, this._spec.maxFps);
      if (fps !== null) return this._apply(now, this._cols, fps, 'reduce-fps');
    }

    // Recovery: only with clear headroom, three evaluations in a row, and only up to the tier's cap.
    const headroom = render < budget * BUDGET_RAISE && (frame <= 0 || frame <= budget * FRAME_OK);
    if (!headroom) {
      this._goodStreak = 0;
      return null;
    }
    this._goodStreak++;
    if (this._goodStreak < RAISE_EVALS) return null;
    if (this._cols < this._spec.maxCols) {
      const cols = Math.min(this._spec.maxCols, Math.max(this._cols + 1, Math.round(this._cols * COLS_UP)));
      if (cols > this._cols) return this._apply(now, cols, this._fps, 'raise-cols');
    }
    if (this._fps < this._spec.maxFps) {
      const fps = stepFps(this._fps, 1, this._spec.maxFps);
      if (fps !== null) return this._apply(now, this._cols, fps, 'raise-fps');
    }
    this._goodStreak = 0;
    return null;
  }

  _apply(now, cols, fps, reason) {
    this._cols = cols;
    this._fps = fps;
    this._cooldownUntil = now + COOLDOWN_MS;
    this._lastEvalAt = now;
    this._goodStreak = 0;
    this._adjustments++;
    return { cols, fps, reason };
  }

  /**
   * The hero's CSS width changed: re-derive the column count.
   * Even when the count stays the same the grid geometry moved, so the measured cost is stale and
   * the next frames re-warm instead of acting on old data.
   * @param {{widthHint: number}} [input]
   * @returns {null | {cols: number, fps: number, reason: 'resize'}}
   */
  resize(input) {
    const widthHint = input && typeof input === 'object' ? input.widthHint : NaN;
    if (!finite(widthHint) || widthHint <= 0) return null;
    this._rewarm = true;
    const cols = colsForWidth(widthHint, this._spec.cellPx, this._spec.minCols, this._spec.maxCols);
    if (cols === this._cols) return null;
    this._cols = cols;
    this._goodStreak = 0;
    this._adjustments++;
    return { cols, fps: this._fps, reason: 'resize' };
  }

  /** Snapshot for the status line and for tests. */
  get state() {
    return {
      cols: this._cols,
      fps: this._fps,
      renderEma: this._renderEma,
      frameEma: this._frameEma,
      tier: this._spec.tier,
      adjustments: this._adjustments,
    };
  }

  /** Back to the constructor's starting point (counters, EMAs and cooldowns included). */
  reset() {
    this._cols = this._initial.cols;
    this._fps = this._initial.fps;
    this._renderEma = 0;
    this._frameEma = 0;
    this._frames = 0;
    this._t0 = null;
    this._lastEvalAt = null;
    this._cooldownUntil = 0;
    this._goodStreak = 0;
    this._adjustments = 0;
    this._rewarm = false;
  }
}

/** First sample seeds the EMA so a slow start-up frame is acted on immediately. */
function ema(previous, value, alpha) {
  return previous > 0 ? previous * (1 - alpha) + value * alpha : value;
}
