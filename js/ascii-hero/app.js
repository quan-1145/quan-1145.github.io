/**
 * app.js — mounts the ASCII hero on a DOM root and owns its whole runtime.
 *
 * Per frame: source.drawInto(grid canvas) -> getImageData -> mapFrame(fb) ->
 * CanvasRenderer.draw, on a requestAnimationFrame loop with an ideal-deadline
 * throttle (target fps is a cap, never a metronome). Quality (cols, fps) comes
 * from perf.QualityController and is re-applied immediately.
 */

import {
  DEFAULT_CHAR_ASPECT,
  buildRamp,
  buildChannelLUT,
  computeGrid,
  createFrameBuffer,
  mapFrame,
  frameToText,
  clamp,
} from './core.js';
import { CanvasRenderer, measureAdvanceRatio, fontSizeForCell } from './renderer.js';
import { QualityController, detectDeviceTier } from './perf.js';
import { VideoSource } from './video-source.js';
import { HelloSource } from './hello-source.js';

const FONT_STACK = '"Ubuntu Mono", "Cascadia Mono", Consolas, Monaco, monospace';
const DEFAULT_ACCENT = '#00ff00';
const DEFAULT_SECONDARY = '#44aaff';
const HELLO_HINT = '';
const VIDEO_HINT = '';
const BLOCKED_HINT = '[ autoplay was blocked - press play ]';

const DEFAULT_OPTIONS = Object.freeze({
  cols: 0,
  fps: 0,
  chars: 'classic',
  colorMode: 'accent',
  fit: 'contain',
  maxCols: 0,
  maxFps: 0,
  autoQuality: true,
  brightness: 0,
  contrast: 1,
  gamma: 1,
});

const COLOR_MODES = ['accent', 'color', 'gray', 'mono'];
const FITS = ['contain', 'cover', 'stretch'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'ogm'];
const ROOT_CLASSES = [
  'is-ready',
  'is-demo',
  'is-video',
  'is-paused',
  'is-dragover',
  'is-error',
  'is-reduced-motion',
];
const META_TIMEOUT_MS = 15000;
const FALLBACK_DELAY_MS = 2600;
const UI_INTERVAL_MS = 200;

function toInt(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function clampInt(value, lo, hi) {
  return Math.min(hi, Math.max(lo, toInt(value)));
}

function round(value, digits) {
  const k = Math.pow(10, digits);
  return Math.round(value * k) / k;
}

/** CSS colour (#rgb / #rrggbb) -> 0xRRGGBB, the frame buffer packed format. */
function packColor(value) {
  const s = String(value || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return parseInt(m[1], 16) >>> 0;
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return parseInt(m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2], 16) >>> 0;
  return 0x00ff00;
}

function formatTime(seconds) {
  let total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  total = Math.min(total, 359999);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function stubController(message, root, el) {
  if (root && root.classList) root.classList.add('is-error');
  if (el && el.status) el.status.textContent = message;
  const state = {
    kind: 'hello',
    cols: 0,
    rows: 0,
    fps: 0,
    paused: true,
    ready: false,
    sourceLabel: 'hello',
    error: message,
    tier: 'low',
    dpr: 1,
  };
  return {
    get state() {
      return { ...state };
    },
    getStats() {
      return { fps: 0, renderMs: 0, frames: 0, skipped: 0, adjustments: 0, dpr: 1, canvasW: 0, canvasH: 0 };
    },
    setOptions() {
      return { ...state };
    },
    renderOnce() {
      return false;
    },
    getFrameText() {
      return '';
    },
    loadFile() {
      return Promise.resolve(false);
    },
    loadUrl() {
      return Promise.resolve(false);
    },
    playDemo() {},
    togglePlay() {},
    play() {},
    pause() {},
    destroy() {},
  };
}

export function mountAsciiHero(root, options = {}) {
  const el = {
    canvas: root ? root.querySelector('[data-ascii-canvas]') : null,
    status: root ? root.querySelector('[data-ascii-status]') : null,
    transport: root ? root.querySelector('[data-ascii-transport]') : null,
    video: root ? root.querySelector('[data-ascii-video]') : null,
    file: root ? root.querySelector('[data-ascii-file]') : null,
    seek: root ? root.querySelector('[data-ascii-seek]') : null,
    time: root ? root.querySelector('[data-ascii-time]') : null,
    hint: root ? root.querySelector('[data-ascii-hint-text]') : null,
    hintBox: root ? root.querySelector('.terminal-hero__hint') : null,
    play: root ? root.querySelector('[data-action="play"]') : null,
    mute: root ? root.querySelector('[data-action="mute"]') : null,
  };

  if (!root || typeof root.querySelector !== 'function') {
    return stubController('The ASCII hero was not found.', null, el);
  }
  if (!el.canvas) return stubController('The ASCII hero canvas is missing.', root, el);

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  let destroyed = false;
  let booted = false;
  const listeners = [];

  let opt = normalizeOptions(options);
  let tier = {};
  let qc = null;
  let renderer = null;
  let hello = null;
  let source = null;
  let sample = null;
  let sampleCtx = null;
  let fb = null;
  let rgba = new Uint8ClampedArray(0);
  let ramp = ' .:-=+*#%@';
  let lut = buildChannelLUT(0, 1, 1);
  let accent = DEFAULT_ACCENT;
  let accentPacked = 0x00ff00;
  let secondary = DEFAULT_SECONDARY;
  let charAspect = DEFAULT_CHAR_ASPECT;
  let cols = 60;
  let fixedCols = false;
  let fixedFps = false;
  let colsFloor = 16;
  let colsCap = 200;
  let fpsCap = 60;
  let maxDpr = 2;
  let reducedMotion = false;
  let userPaused = false;
  let autoplayBlocked = false;
  let hintOverride = '';
  let onScreen = true;
  let objectUrl = null;
  let suppressVideoError = false;
  let failTimer = 0;
  let uiTimer = 0;
  let lastUiAt = 0;
  let resizeRaf = 0;
  let seekDragging = false;
  let dragDepth = 0;
  let firstFramePainted = false;
  let srcW = 0;
  let srcH = 0;
  let loadToken = 0;
  let ro = null;
  let io = null;
  let rafId = 0;
  let running = false;
  let nextRenderAt = 0;
  let cssW = 0;
  let cssH = 0;
  let canvasW = 0;
  let canvasH = 0;
  let dpr = 1;
  let drawFont = `10px ${FONT_STACK}`;
  let grid = { cols: 0, rows: 0, cellW: 1, cellH: 1 };

  const st = { kind: 'hello', sourceLabel: 'hello', fps: 24, error: null };
  const stats = { fpsEma: 0, renderMs: 0, frames: 0, skipped: 0, adjustments: 0, lastFrameAt: 0 };

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function on(target, type, handler, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, opts);
    listeners.push([target, type, handler, opts]);
  }

  function offAll() {
    for (let i = 0; i < listeners.length; i += 1) {
      const entry = listeners[i];
      try {
        entry[0].removeEventListener(entry[1], entry[2], entry[3]);
      } catch {
        /* ignore */
      }
    }
    listeners.length = 0;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setAttr(node, name, value) {
    if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function normalizeOptions(raw) {
    const o = { ...DEFAULT_OPTIONS };
    if (!raw || typeof raw !== 'object') return o;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const nCols = num(raw.cols);
    if (nCols && nCols > 0) o.cols = Math.round(Math.min(500, nCols));
    const nFps = num(raw.fps);
    if (nFps && nFps > 0) o.fps = Math.round(Math.min(120, nFps));
    const nMaxCols = num(raw.maxCols);
    if (nMaxCols && nMaxCols > 0) o.maxCols = Math.round(Math.min(500, nMaxCols));
    const nMaxFps = num(raw.maxFps);
    if (nMaxFps && nMaxFps > 0) o.maxFps = Math.round(Math.min(120, nMaxFps));
    if (typeof raw.chars === 'string' && raw.chars.length > 0) o.chars = raw.chars;
    if (typeof raw.colorMode === 'string' && COLOR_MODES.indexOf(raw.colorMode) >= 0) {
      o.colorMode = raw.colorMode;
    }
    if (typeof raw.fit === 'string' && FITS.indexOf(raw.fit) >= 0) o.fit = raw.fit;
    if (typeof raw.autoQuality === 'boolean') o.autoQuality = raw.autoQuality;
    const b = num(raw.brightness);
    if (b !== null) o.brightness = clamp(b, -1, 1);
    const c = num(raw.contrast);
    if (c !== null) o.contrast = clamp(c, 0, 2);
    const g = num(raw.gamma);
    if (g !== null && g > 0) o.gamma = clamp(g, 0.1, 4);
    return o;
  }

  function readReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function resolveCssColor(name, fallback) {
    try {
      const value = getComputedStyle(root).getPropertyValue(name).trim();
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  function safeAdvanceRatio() {
    try {
      const ratio = measureAdvanceRatio(FONT_STACK);
      if (Number.isFinite(ratio) && ratio > 0.1 && ratio < 2) return ratio;
    } catch {
      /* fall through to the default */
    }
    return DEFAULT_CHAR_ASPECT;
  }

  function mapMode() {
    if (opt.colorMode === 'color') return 'color';
    if (opt.colorMode === 'gray') return 'gray';
    return 'mono';
  }

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */
  function measure() {
    const rect = root.getBoundingClientRect();
    cssW = Math.max(0, rect.width);
    cssH = Math.max(0, rect.height);
    const rawDpr = window.devicePixelRatio || 1;
    dpr = Math.min(rawDpr, maxDpr > 0 ? maxDpr : 2);
    canvasW = Math.max(1, Math.round(cssW * dpr));
    canvasH = Math.max(1, Math.round(cssH * dpr));
  }

  function updateDrawFont() {
    let size = 10;
    try {
      size = fontSizeForCell(grid.cellW, charAspect);
    } catch {
      size = 10;
    }
    if (!Number.isFinite(size) || size <= 0) size = 10;
    drawFont = `${size.toFixed(2)}px ${FONT_STACK}`;
  }

  function rebuildGrid() {
    if (!(canvasW > 0) || !(canvasH > 0) || !sample) return;
    const next = computeGrid({ canvasW, canvasH, cols, rows: 0, autoRows: true, charAspect });
    const unchanged =
      grid.cols === next.cols &&
      grid.rows === next.rows &&
      grid.cellW === next.cellW &&
      grid.cellH === next.cellH &&
      !!fb;
    grid = next;
    if (!unchanged) {
      if (sample.width !== next.cols || sample.height !== next.rows) {
        sample.width = next.cols;
        sample.height = next.rows;
      }
      fb = createFrameBuffer(next.cols, next.rows);
      rgba = new Uint8ClampedArray(next.cols * next.rows * 4);
    }
    updateDrawFont();
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  function renderFrame(now = 0, frameMs = 0) {
    if (!renderer || !sampleCtx || !fb || !source || !source.ready) return false;
    const t0 = performance.now();
    const gridCols = grid.cols;
    const gridRows = grid.rows;
    const displayAspect = cssW > 0 && cssH > 0 ? cssW / cssH : gridCols / gridRows;

    let ok = false;
    if (st.kind === 'hello') {
      ok = hello.drawInto(sampleCtx, gridCols, gridRows, { displayAspect });
    } else {
      ok = source.drawInto(sampleCtx, gridCols, gridRows, {
        fit: opt.fit,
        displayAspect,
        highQuality: true,
      });
    }
    if (!ok) return false;

    const data = sampleCtx.getImageData(0, 0, gridCols, gridRows).data;
    if (rgba.length !== data.length) rgba = new Uint8ClampedArray(data.length);
    rgba.set(data);

    mapFrame(rgba, fb, { ramp, lut, colorMode: mapMode(), monoPacked: accentPacked });
    renderer.draw(fb, {
      ramp,
      cellW: grid.cellW,
      cellH: grid.cellH,
      font: drawFont,
    });

    const wall = performance.now();
    const renderMs = wall - t0;
    stats.renderMs = stats.renderMs > 0 ? stats.renderMs * 0.85 + renderMs * 0.15 : renderMs;
    stats.frames += 1;
    if (stats.lastFrameAt > 0) {
      const dt = wall - stats.lastFrameAt;
      if (dt > 0 && dt < 1000) {
        const inst = 1000 / dt;
        stats.fpsEma = stats.fpsEma > 0 ? stats.fpsEma * 0.9 + inst * 0.1 : inst;
      }
    }
    stats.lastFrameAt = wall;

    if (!firstFramePainted) {
      firstFramePainted = true;
      syncClasses();
    }

    if (opt.autoQuality && qc) {
      const change = qc.observe({
        renderMs,
        frameMs: frameMs > 0 ? frameMs : 1000 / Math.max(1, st.fps),
        now: now || wall,
      });
      if (change) applyQuality(change);
    }
    return true;
  }

  function safeRender() {
    if (destroyed) return false;
    try {
      return renderFrame(performance.now(), 0);
    } catch (err) {
      handleRuntimeError(err);
      return false;
    }
  }

  /**
   * Upper bound on columns that keeps one character cell readable. The quality
   * controller may raise the resolution on a fast device, but it must not turn
   * the headline into a 3 px mosaic on a narrow window: never let a cell get
   * smaller than ~72% of the tier's preferred cell size (4 CSS px floor).
   */
  function densityCap() {
    const cellPx = tier && Number(tier.cellPx) > 0 ? Number(tier.cellPx) : 7;
    const minCell = Math.max(4, cellPx * 0.72);
    return Math.max(16, Math.floor(cssW / minCell));
  }

  function applyDensityCap() {
    const tierCap =
      opt.maxCols > 0
        ? Math.round(opt.maxCols)
        : tier && tier.maxCols > 0
          ? Math.round(tier.maxCols)
          : 200;
    colsCap = Math.max(1, Math.min(tierCap, densityCap()));
    if (colsFloor > colsCap) colsFloor = colsCap;
  }

  function applyQuality(change) {
    if (!change || destroyed) return;
    let applied = false;
    const nextCols = toInt(change.cols);
    const nextFps = toInt(change.fps);
    if (nextCols > 0 && !fixedCols) {
      const c = clampInt(nextCols, colsFloor, Math.min(colsCap, 500));
      if (c !== cols) {
        cols = c;
        rebuildGrid();
        applied = true;
      }
    }
    if (nextFps > 0 && !fixedFps) {
      const f = clampInt(nextFps, 1, Math.min(fpsCap, 120));
      if (f !== st.fps) {
        st.fps = f;
        applied = true;
      }
    }
    if (!applied) return;
    stats.adjustments += 1;
    scheduleUi(true);
  }

  /* ------------------------------------------------------------------ *
   * Frame loop
   * ------------------------------------------------------------------ */
  function startLoop() {
    if (running || destroyed || !booted) return;
    running = true;
    nextRenderAt = 0;
    stats.lastFrameAt = 0; // do not feed a resume gap into the fps estimate
    rafId = requestAnimationFrame(onFrame);
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    nextRenderAt = 0;
  }

  function onFrame(now) {
    if (!running || destroyed) return;
    rafId = requestAnimationFrame(onFrame);
    try {
      const capMs = st.fps > 0 ? 1000 / st.fps : 0;
      if (capMs) {
        if (now + 0.5 < nextRenderAt) {
          stats.skipped += 1;
          return;
        }
        nextRenderAt += capMs;
        // Far behind (slow render, tab wake-up): re-sync instead of catching up.
        if (nextRenderAt < now - capMs) nextRenderAt = now + capMs;
      }
      if (!source || !source.ready) return;
      if (st.kind === 'video' && el.video && (el.video.paused || el.video.ended)) return;
      const frameMs = stats.lastFrameAt > 0 ? now - stats.lastFrameAt : capMs || 16.7;
      if (st.kind === 'hello' && hello) hello.tick(frameMs);
      renderFrame(now, frameMs);
      scheduleUi();
    } catch (err) {
      handleRuntimeError(err);
    }
  }

  function shouldRun() {
    if (destroyed || !booted) return false;
    if (!onScreen) return false;
    if (document.visibilityState === 'hidden') return false;
    if (!source || !source.ready) return false;
    if (st.kind === 'hello') return !reducedMotion && !userPaused;
    return !!(el.video && !el.video.paused && !el.video.ended);
  }

  function updateRunState() {
    syncClasses();
    if (shouldRun()) startLoop();
    else stopLoop();
  }

  /* ------------------------------------------------------------------ *
   * Status line, hints and root classes
   * ------------------------------------------------------------------ */
  function isPaused() {
    if (st.kind === 'video') return el.video ? el.video.paused : true;
    return userPaused || reducedMotion;
  }

  function updateHint() {
    if (!el.hint) return;
    let text = '';
    if (hintOverride) {
      text = hintOverride;
    } else if (st.kind === 'video') {
      text = autoplayBlocked ? BLOCKED_HINT : VIDEO_HINT;
    } else {
      text = HELLO_HINT;
    }
    setText(el.hint, text);
    // Static instructions were removed on purpose (the video player is a
    // hidden easter egg); the line only appears for transient messages.
    if (el.hintBox) el.hintBox.hidden = text.length === 0;
  }

  function updateStatus() {
    if (!el.status) return;
    if (st.error) {
      setText(el.status, st.error);
      return;
    }
    if (!firstFramePainted) return;
    const parts = [st.kind];
    if (st.kind === 'video') {
      parts.push(st.sourceLabel || 'video');
      if (srcW > 0 && srcH > 0) parts.push(`${srcW}\u00d7${srcH}`);
    }
    parts.push(`${grid.cols}\u00d7${grid.rows}`);
    parts.push(`${st.fps}fps`);
    if (isPaused()) parts.push('paused');
    setText(el.status, parts.join(' \u00b7 '));
  }

  function scheduleUi(force = false) {
    if (!el.status && !el.time && !el.hint) return;
    if (force) {
      if (uiTimer) clearTimeout(uiTimer);
      uiTimer = 0;
      updateUi();
      return;
    }
    const wait = UI_INTERVAL_MS - (performance.now() - lastUiAt);
    if (wait <= 0) {
      updateUi();
      return;
    }
    if (!uiTimer) {
      uiTimer = setTimeout(() => {
        uiTimer = 0;
        updateUi();
      }, wait);
    }
  }

  function updateUi() {
    lastUiAt = performance.now();
    syncTransport();
    updateTransport();
    updateHint();
    updateStatus();
  }

  function syncClasses() {
    if (!root || !root.classList) return;
    root.classList.toggle('is-ready', firstFramePainted);
    root.classList.toggle('is-demo', st.kind === 'hello');
    root.classList.toggle('is-video', st.kind === 'video');
    root.classList.toggle('is-paused', isPaused());
    root.classList.toggle('is-error', !!st.error);
    root.classList.toggle('is-reduced-motion', reducedMotion);
    if (el.transport) el.transport.hidden = st.kind !== 'video';
  }

  function syncTransport() {
    if (el.transport) el.transport.hidden = st.kind !== 'video';
    const playing = st.kind === 'video' ? !!(el.video && !el.video.paused) : !isPaused();
    if (el.play) {
      setText(el.play, playing ? '[pause]' : '[play]');
      setAttr(el.play, 'aria-label', playing ? 'Pause the ASCII video' : 'Play the ASCII video');
    }
    if (el.mute) {
      const muted = !el.video || el.video.muted;
      setText(el.mute, muted ? '[muted]' : '[sound]');
      setAttr(el.mute, 'aria-label', muted ? 'Unmute the ASCII video' : 'Mute the ASCII video');
    }
  }

  function updateTransport() {
    if (st.kind !== 'video' || !el.video) return;
    const video = el.video;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (el.time) setText(el.time, `${formatTime(current)} / ${formatTime(duration)}`);
    if (el.seek && !seekDragging && duration > 0) {
      const value = String(Math.round((current / duration) * 1000));
      if (el.seek.value !== value) el.seek.value = value;
    }
  }

  function setError(message) {
    st.error = message || 'Playback failed.';
    syncClasses();
    scheduleUi(true);
  }

  function clearError() {
    if (!st.error) return;
    st.error = null;
    syncClasses();
    scheduleUi(true);
  }

  function handleRuntimeError(err) {
    stopLoop();
    const tainted =
      !!err && (err.name === 'SecurityError' || /insecure|tainted|cross-origin/i.test(String(err.message || '')));
    st.error = tainted
      ? 'The browser blocked the video pixels - try a local file.'
      : 'The ASCII hero hit a problem - reload the page.';
    syncClasses();
    scheduleUi(true);
    if (tainted) scheduleFallbackToDemo();
  }

  /* ------------------------------------------------------------------ *
   * Frame sources
   * ------------------------------------------------------------------ */
  function createHello() {
    return new HelloSource({ fontFamily: FONT_STACK, accent, secondary });
  }

  function setHelloSource() {
    hello = createHello();
    source = hello;
    st.kind = 'hello';
    st.sourceLabel = 'hello';
    st.error = null;
    userPaused = false;
    autoplayBlocked = false;
    hintOverride = '';
    srcW = 0;
    srcH = 0;
    stats.frames = 0;
    stats.skipped = 0;
    stats.fpsEma = 0;
    stats.lastFrameAt = 0;
  }

  function setVideoSource(next, label) {
    source = next;
    st.kind = 'video';
    st.sourceLabel = label || 'video';
    st.error = null;
    userPaused = false;
    hintOverride = '';
    stats.frames = 0;
    stats.skipped = 0;
    stats.fpsEma = 0;
    stats.lastFrameAt = 0;
  }

  /* ------------------------------------------------------------------ *
   * Object URL / <video> lifecycle
   * ------------------------------------------------------------------ */
  function revokeObjectUrl() {
    if (!objectUrl) return;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
    objectUrl = null;
  }

  function resetVideoElement() {
    const video = el.video;
    if (!video) return;
    const wasSuppressed = suppressVideoError;
    suppressVideoError = true;
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignore */
    }
    suppressVideoError = wasSuppressed;
  }

  function waitForMetadata(video) {
    return new Promise((resolve, reject) => {
      let timer = 0;
      const finish = (err) => {
        if (timer) clearTimeout(timer);
        timer = 0;
        video.removeEventListener('loadedmetadata', onOk);
        video.removeEventListener('error', onError);
        video.removeEventListener('abort', onError);
        if (err) reject(err);
        else resolve();
      };
      const onOk = () => finish(null);
      const onError = () => finish(new Error('media'));
      timer = setTimeout(() => finish(new Error('timeout')), META_TIMEOUT_MS);
      video.addEventListener('loadedmetadata', onOk);
      video.addEventListener('error', onError);
      video.addEventListener('abort', onError);
      if (video.readyState >= 1 && video.videoWidth > 0) finish(null);
    });
  }

  function clearFailTimer() {
    if (!failTimer) return;
    clearTimeout(failTimer);
    failTimer = 0;
  }

  function scheduleFallbackToDemo() {
    clearFailTimer();
    failTimer = setTimeout(() => {
      failTimer = 0;
      if (!destroyed) fallbackToDemo();
    }, FALLBACK_DELAY_MS);
  }

  function fallbackToDemo() {
    const message = st.error;
    showDemo();
    if (message) {
      hintOverride = `[ ${String(message).replace(/\.\s*$/, '')} ]`;
      updateHint();
      scheduleUi(true);
    }
  }

  async function loadVideo(url, label, nextObjectUrl, isFile) {
    const video = el.video;
    if (!video) {
      if (nextObjectUrl) {
        try {
          URL.revokeObjectURL(nextObjectUrl);
        } catch {
          /* ignore */
        }
      }
      setError('The video element is missing.');
      return false;
    }
    const token = (loadToken += 1);
    clearFailTimer();
    if (objectUrl && objectUrl !== nextObjectUrl) revokeObjectUrl();
    objectUrl = nextObjectUrl;
    suppressVideoError = true;
    try {
      video.muted = true;
      video.loop = true;
      video.src = url;
      try {
        video.load();
      } catch {
        /* load() is best effort */
      }
      await waitForMetadata(video);
      if (token !== loadToken) return false; // a newer load owns the element
      if (destroyed) {
        suppressVideoError = false;
        return false;
      }

      srcW = video.videoWidth || 0;
      srcH = video.videoHeight || 0;
      stopLoop();
      setVideoSource(new VideoSource(video), label);
      try {
        const played = video.play();
        if (played && typeof played.then === 'function') {
          await played.catch(() => {
            autoplayBlocked = true;
          });
        }
      } catch {
        autoplayBlocked = true;
      }
      if (token !== loadToken) return false;
      if (destroyed) {
        suppressVideoError = false;
        return false;
      }
      suppressVideoError = false;
      clearError();
      syncClasses();
      rebuildGrid();
      safeRender();
      scheduleUi(true);
      updateRunState();
      return true;
    } catch (err) {
      if (token !== loadToken) return false;
      if (destroyed) {
        suppressVideoError = false;
        return false;
      }
      const timedOut = !!err && err.message === 'timeout';
      let message;
      if (timedOut) message = 'That video took too long to load - try a smaller file.';
      else if (isFile) message = `Can't decode "${label}" - try an H.264 MP4.`;
      else message = 'That video could not be loaded - try a local file.';
      setError(message);
      resetVideoElement();
      if (nextObjectUrl && objectUrl === nextObjectUrl) revokeObjectUrl();
      suppressVideoError = false;
      scheduleFallbackToDemo();
      return false;
    }
  }

  function loadFile(file) {
    if (destroyed || !file) return Promise.resolve(false);
    if (!isVideoFile(file)) {
      setError('Not a video file - choose an MP4, WebM, MOV or MKV.');
      return Promise.resolve(false);
    }
    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch {
      setError('That file could not be opened.');
      return Promise.resolve(false);
    }
    return loadVideo(url, file.name || 'video', url, true);
  }

  function loadUrl(url, label) {
    if (destroyed) return Promise.resolve(false);
    if (typeof url !== 'string' || url.length === 0) {
      setError('No video address was given.');
      return Promise.resolve(false);
    }
    return loadVideo(url, label || url, null, false);
  }

  function isVideoFile(file) {
    if (!file) return false;
    if (String(file.type || '').toLowerCase().indexOf('video/') === 0) return true;
    const name = String(file.name || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    return VIDEO_EXTS.indexOf(name.slice(dot + 1).toLowerCase()) >= 0;
  }

  /* ------------------------------------------------------------------ *
   * Playback control
   * ------------------------------------------------------------------ */
  function showDemo() {
    if (destroyed) return;
    stopLoop();
    clearFailTimer();
    resetVideoElement();
    revokeObjectUrl();
    setHelloSource();
    syncClasses();
    rebuildGrid();
    safeRender();
    scheduleUi(true);
    updateRunState();
  }

  function play() {
    if (destroyed) return;
    if (st.kind === 'video') {
      const video = el.video;
      if (!video) return;
      try {
        const played = video.play();
        if (played && typeof played.catch === 'function') {
          played.catch(() => {
            autoplayBlocked = true;
            syncClasses();
            scheduleUi(true);
          });
        }
      } catch {
        autoplayBlocked = true;
      }
      return;
    }
    userPaused = false;
    updateRunState();
    scheduleUi(true);
  }

  function pause() {
    if (destroyed) return;
    if (st.kind === 'video') {
      if (el.video) {
        try {
          el.video.pause();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    userPaused = true;
    updateRunState();
    scheduleUi(true);
  }

  function togglePlay() {
    if (destroyed) return;
    if (st.kind === 'video') {
      if (el.video && !el.video.paused) pause();
      else play();
      return;
    }
    if (userPaused) play();
    else pause();
  }

  function toggleMute() {
    if (destroyed || !el.video) return;
    el.video.muted = !el.video.muted;
    scheduleUi(true);
  }

  function pickFile() {
    if (destroyed || !el.file) return;
    try {
      el.file.click();
    } catch {
      setError('The file picker is not available.');
    }
  }

  function seekToRatio(ratio) {
    const video = el.video;
    if (!video) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!duration) return;
    try {
      video.currentTime = clamp(ratio, 0, 1) * duration;
    } catch {
      /* seek is best effort */
    }
    updateTransport();
  }

  /* ------------------------------------------------------------------ *
   * DOM events
   * ------------------------------------------------------------------ */
  function onRootClick(event) {
    if (!event || event.button !== 0) return;
    const target = event.target;
    if (target && typeof target.closest === 'function') {
      const actionEl = target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        if (action === 'play') togglePlay();
        else if (action === 'mute') toggleMute();
        else if (action === 'load') pickFile();
        else if (action === 'demo') showDemo();
        return;
      }
      if (target.closest('button, a, input, select, [data-ascii-transport], [data-no-ascii-click]')) {
        return;
      }
    }
    if (st.kind === 'hello') pickFile();
    else togglePlay();
  }

  function hasFileDrag(event) {
    const dt = event && event.dataTransfer;
    if (!dt || !dt.types) return false;
    const types = dt.types;
    for (let i = 0; i < types.length; i += 1) {
      if (types[i] === 'Files') return true;
    }
    return typeof types.contains === 'function' ? types.contains('Files') : false;
  }

  function onDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    if (hasFileDrag(event) && root.classList) root.classList.add('is-dragover');
  }

  function onDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!hasFileDrag(event)) return;
    if (root.classList) root.classList.add('is-dragover');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && root.classList) root.classList.remove('is-dragover');
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    if (root.classList) root.classList.remove('is-dragover');
    const dt = event.dataTransfer;
    const file = dt && dt.files && dt.files[0];
    if (!file) return;
    if (!isVideoFile(file)) {
      setError('Not a video file - drop an MP4, WebM, MOV or MKV.');
      return;
    }
    loadFile(file);
  }

  function preventWindowFileDrop(event) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
  }

  function onVideoPlay() {
    autoplayBlocked = false;
    syncClasses();
    scheduleUi(true);
    updateRunState();
  }

  function onVideoPause() {
    syncClasses();
    scheduleUi(true);
    safeRender();
    updateRunState();
  }

  function onVideoError() {
    if (suppressVideoError || destroyed || st.kind !== 'video') return;
    setError('Video playback failed - try another file.');
    scheduleFallbackToDemo();
  }

  function bindEvents() {
    on(root, 'click', onRootClick);
    on(root, 'dragenter', onDragEnter);
    on(root, 'dragover', onDragOver);
    on(root, 'dragleave', onDragLeave);
    on(root, 'drop', onDrop);
    on(window, 'dragover', preventWindowFileDrop);
    on(window, 'drop', preventWindowFileDrop);

    if (el.file) {
      on(el.file, 'change', () => {
        const file = el.file.files && el.file.files[0];
        if (file) loadFile(file);
        try {
          el.file.value = '';
        } catch {
          /* ignore */
        }
      });
    }

    if (el.seek) {
      on(el.seek, 'input', () => {
        if (!el.seek) return;
        seekToRatio(Number(el.seek.value) / 1000);
      });
      on(el.seek, 'pointerdown', () => {
        seekDragging = true;
      });
      on(el.seek, 'pointerup', () => {
        seekDragging = false;
      });
      on(el.seek, 'pointercancel', () => {
        seekDragging = false;
      });
      on(el.seek, 'change', () => {
        seekDragging = false;
      });
    }

    const video = el.video;
    if (video) {
      on(video, 'play', onVideoPlay);
      on(video, 'pause', onVideoPause);
      on(video, 'seeked', () => {
        safeRender();
        scheduleUi(true);
      });
      on(video, 'loadeddata', () => {
        safeRender();
        scheduleUi(true);
      });
      on(video, 'timeupdate', () => scheduleUi());
      on(video, 'loadedmetadata', () => {
        srcW = video.videoWidth || 0;
        srcH = video.videoHeight || 0;
        scheduleUi(true);
      });
      on(video, 'durationchange', () => scheduleUi(true));
      on(video, 'ended', () => {
        syncClasses();
        scheduleUi(true);
        updateRunState();
      });
      on(video, 'error', onVideoError);
    }
  }

  function observeLayout() {
    if (typeof ResizeObserver === 'function') {
      try {
        ro = new ResizeObserver(() => {
          if (destroyed) return;
          if (resizeRaf) cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            handleResize();
          });
        });
        ro.observe(root);
      } catch {
        ro = null;
      }
    }
    if (!ro) on(window, 'resize', handleResize);

    if (typeof IntersectionObserver === 'function') {
      try {
        io = new IntersectionObserver(
          (entries) => {
            for (let i = 0; i < entries.length; i += 1) onScreen = entries[i].isIntersecting;
            updateRunState();
          },
          { threshold: 0 }
        );
        io.observe(root);
      } catch {
        io = null;
      }
    }

    on(document, 'visibilitychange', updateRunState);
    on(window, 'pagehide', () => {
      stopLoop();
      revokeObjectUrl();
    });

    try {
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motion && typeof motion.addEventListener === 'function') {
        on(motion, 'change', () => {
          reducedMotion = !!motion.matches;
          if (reducedMotion) stopLoop();
          syncClasses();
          scheduleUi(true);
          updateRunState();
        });
      }
    } catch {
      /* no matchMedia: reduced motion stays off */
    }
  }

  function handleResize() {
    if (destroyed) return;
    try {
      const rect = root.getBoundingClientRect();
      const w = Math.max(0, rect.width);
      const h = Math.max(0, rect.height);
      if (w < 2 || h < 2) return;
      const rawDpr = window.devicePixelRatio || 1;
      const nextDpr = Math.min(rawDpr, maxDpr > 0 ? maxDpr : 2);
      const nextW = Math.max(1, Math.round(w * nextDpr));
      const nextH = Math.max(1, Math.round(h * nextDpr));
      const changed = nextW !== canvasW || nextH !== canvasH || nextDpr !== dpr;
      cssW = w;
      cssH = h;
      applyDensityCap(); // the readable-columns bound follows the new width
      if (!changed) return;
      dpr = nextDpr;
      canvasW = nextW;
      canvasH = nextH;
      if (renderer) renderer.resize(canvasW, canvasH);

      let quality = null;
      try {
        quality = qc ? qc.resize({ widthHint: cssW }) : null;
      } catch {
        quality = null;
      }
      if (quality) applyQuality(quality);
      // A narrower window may have lowered the density bound below the current grid.
      if (!fixedCols && cols > colsCap) cols = colsCap;
      rebuildGrid();
      safeRender();
      scheduleUi(true);
    } catch (err) {
      handleRuntimeError(err);
    }
  }

  /* ------------------------------------------------------------------ *
   * Options
   * ------------------------------------------------------------------ */
  function setOptions(patch) {
    if (destroyed || !patch || typeof patch !== 'object') return api.state;
    opt = normalizeOptions({ ...opt, ...patch });
    clearFailTimer();
    hintOverride = '';
    ramp = buildRamp(opt.chars, '', false);
    lut = buildChannelLUT(opt.brightness, opt.contrast, opt.gamma);
    accent = resolveCssColor('--accent', accent);
    secondary = resolveCssColor('--info', secondary);
    accentPacked = packColor(accent);
    if (hello) hello.setAccent(accent);
    applyDensityCap();
    fixedCols = opt.cols > 0;
    fixedFps = opt.fps > 0;
    if (fixedCols) {
      cols = clampInt(opt.cols, 1, 500);
    } else {
      let quality = null;
      try {
        quality = qc ? qc.resize({ widthHint: cssW }) : null;
      } catch {
        quality = null;
      }
      const autoCols =
        quality && quality.cols > 0
          ? quality.cols
          : qc && qc.state && qc.state.cols > 0
            ? qc.state.cols
            : cols;
      cols = clampInt(autoCols, colsFloor, Math.min(colsCap, 500));
    }
    if (fixedFps) {
      st.fps = clampInt(opt.fps, 1, 120);
    } else if (qc && qc.state && qc.state.fps > 0) {
      st.fps = clampInt(qc.state.fps, 1, 120);
    }
    rebuildGrid();
    safeRender();
    syncClasses();
    scheduleUi(true);
    return api.state;
  }

  /* ------------------------------------------------------------------ *
   * Boot / teardown
   * ------------------------------------------------------------------ */
  function boot() {
    measure();
    reducedMotion = readReducedMotion();

    tier =
      detectDeviceTier({
        hardwareConcurrency: navigator.hardwareConcurrency || 0,
        deviceMemory: navigator.deviceMemory || 0,
        devicePixelRatio: window.devicePixelRatio || 1,
        reducedMotion,
        width: cssW,
        height: cssH,
        touch: (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window,
        saveData: !!(navigator.connection && navigator.connection.saveData),
      }) || {};
    maxDpr = tier.maxDpr > 0 ? tier.maxDpr : 2;
    colsFloor = tier.minCols > 0 ? Math.round(tier.minCols) : 16;
    colsCap = opt.maxCols > 0 ? Math.round(opt.maxCols) : tier.maxCols > 0 ? Math.round(tier.maxCols) : 200;
    fpsCap = opt.maxFps > 0 ? Math.round(opt.maxFps) : tier.maxFps > 0 ? tier.maxFps : 60;
    applyDensityCap();
    if (colsFloor > colsCap) colsFloor = colsCap;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvasW = Math.max(1, Math.round(cssW * dpr));
    canvasH = Math.max(1, Math.round(cssH * dpr));

    renderer = new CanvasRenderer(el.canvas);
    renderer.resize(canvasW, canvasH);

    accent = resolveCssColor('--accent', DEFAULT_ACCENT);
    secondary = resolveCssColor('--info', DEFAULT_SECONDARY);
    accentPacked = packColor(accent);
    charAspect = safeAdvanceRatio();
    ramp = buildRamp(opt.chars, '', false);
    lut = buildChannelLUT(opt.brightness, opt.contrast, opt.gamma);

    sample = document.createElement('canvas');
    sample.width = 1;
    sample.height = 1;
    sampleCtx = sample.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) throw new Error('2d context unavailable');

    setHelloSource();

    qc = new QualityController({ tier, widthHint: cssW });
    fixedCols = opt.cols > 0;
    fixedFps = opt.fps > 0;
    let initial = null;
    try {
      initial = qc.resize({ widthHint: cssW });
    } catch {
      initial = null;
    }
    const qState = qc.state || {};
    const initialCols = fixedCols
      ? opt.cols
      : (initial && initial.cols) || qState.cols || tier.initialCols || 100;
    const initialFps = fixedFps
      ? opt.fps
      : (initial && initial.fps) || qState.fps || tier.initialFps || 30;
    cols = clampInt(initialCols, 1, Math.min(colsCap, 500));
    st.fps = clampInt(initialFps, 1, 120);

    rebuildGrid();
    bindEvents();
    observeLayout();
    safeRender(); // first paint is synchronous: the hero is never empty
    booted = true;
    syncClasses();
    scheduleUi(true);
    updateRunState();

    // The webfont may change the advance ratio; re-measure once it is ready.
    try {
      if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(() => {
          if (destroyed) return;
          const ratio = safeAdvanceRatio();
          if (Math.abs(ratio - charAspect) > 0.005) {
            charAspect = ratio;
            rebuildGrid();
            safeRender();
            scheduleUi(true);
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
    }
    clearFailTimer();
    if (uiTimer) {
      clearTimeout(uiTimer);
      uiTimer = 0;
    }
    offAll();
    if (ro) {
      try {
        ro.disconnect();
      } catch {
        /* ignore */
      }
      ro = null;
    }
    if (io) {
      try {
        io.disconnect();
      } catch {
        /* ignore */
      }
      io = null;
    }
    suppressVideoError = true;
    resetVideoElement();
    revokeObjectUrl();
    if (root.classList) {
      for (let i = 0; i < ROOT_CLASSES.length; i += 1) root.classList.remove(ROOT_CLASSES[i]);
    }
    if (el.transport) el.transport.hidden = true;
    if (window.__ASCII_HERO__ === api) window.__ASCII_HERO__ = null;
  }

  const api = {
    get state() {
      return {
        kind: st.kind,
        cols: grid.cols,
        rows: grid.rows,
        fps: st.fps,
        paused: isPaused(),
        ready: !!(source && source.ready),
        sourceLabel: st.sourceLabel,
        error: st.error || null,
        tier: tier && tier.tier ? tier.tier : 'mid',
        dpr,
      };
    },
    getStats() {
      return {
        fps: round(stats.fpsEma, 1),
        renderMs: round(stats.renderMs, 2),
        frames: stats.frames,
        skipped: stats.skipped,
        adjustments: stats.adjustments,
        dpr,
        canvasW,
        canvasH,
      };
    },
    setOptions,
    renderOnce() {
      return safeRender();
    },
    getFrameText() {
      try {
        return fb ? frameToText(fb, ramp) : '';
      } catch {
        return '';
      }
    },
    loadFile,
    loadUrl,
    playDemo() {
      showDemo();
    },
    togglePlay,
    play,
    pause,
    destroy,
  };

  try {
    boot();
  } catch (err) {
    handleRuntimeError(err);
  }

  return api;
}
