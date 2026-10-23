/**
 * video-source.js — HTMLVideoElement frame source.
 *
 * Port of the reference VideoSource. Two details matter:
 *   - a frame that is downscaled by more than 3x goes through a 3x grid
 *     intermediate canvas, so the browser does not lose detail in one step;
 *   - the fit happens in display space (core.fitRectToGrid), because one
 *     character cell is roughly charAspect as wide as it is tall on screen.
 */

import { fitRectToGrid } from './core.js';

export class VideoSource {
  constructor(videoEl) {
    this.kind = 'video';
    this.video = videoEl || null;
    this.lastRect = null;
    this._mid = null;
  }

  get width() {
    return this.video ? this.video.videoWidth || 0 : 0;
  }

  get height() {
    return this.video ? this.video.videoHeight || 0 : 0;
  }

  get ready() {
    return !!this.video && this.video.readyState >= 2 && this.width > 0 && this.height > 0;
  }

  get duration() {
    const d = this.video ? this.video.duration : 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  get mediaTime() {
    const t = this.video ? this.video.currentTime : 0;
    return Number.isFinite(t) ? t : 0;
  }

  get paused() {
    return this.video ? !!this.video.paused : true;
  }

  /** Draw the current video frame into the cols x rows sampling canvas. */
  drawInto(ctx, w, h, opts = {}) {
    if (!ctx || !(w >= 1) || !(h >= 1)) return false;
    const vw = this.width;
    const vh = this.height;
    if (!vw || !vh) return false;

    const fit = opts.fit || 'contain';
    const highQuality = opts.highQuality !== false;
    const aspect = opts.displayAspect > 0 ? opts.displayAspect : w / h;
    const rect = fitRectToGrid(vw, vh, w, h, fit, aspect);
    this.lastRect = rect;

    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      const shrink = rect.w > 0 ? vw / rect.w : 1;
      if (highQuality && shrink > 3) {
        const iw = Math.max(2, Math.min(vw, Math.round(w * 3)));
        const ih = Math.max(2, Math.round(h * (iw / w)));
        if (!this._mid && typeof document !== 'undefined') {
          this._mid = document.createElement('canvas');
        }
        if (!this._mid) return false;
        if (this._mid.width !== iw || this._mid.height !== ih) {
          this._mid.width = iw;
          this._mid.height = ih;
        }
        const mctx = this._mid.getContext('2d');
        if (!mctx) return false;
        const k = iw / w;
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.imageSmoothingEnabled = true;
        mctx.imageSmoothingQuality = 'high';
        mctx.clearRect(0, 0, iw, ih);
        mctx.drawImage(this.video, rect.x * k, rect.y * k, rect.w * k, rect.h * k);
        ctx.drawImage(this._mid, 0, 0, iw, ih, 0, 0, w, h);
      } else {
        ctx.drawImage(this.video, rect.x, rect.y, rect.w, rect.h);
      }
    } catch {
      return false;
    }
    return true;
  }
}
