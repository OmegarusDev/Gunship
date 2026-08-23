/**
 * World camera — scroll, zoom, follow, edge clamp.
 * Separates world coordinates from screen coordinates.
 * DPR-aware rendering.
 */

import { CAMERA, WORLD_SIZE, TILE_SIZE } from './config.js';
import { lerp } from './rng.js';

export class WorldCamera {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // World position (center of view)
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;

    // Zoom
    this.zoom = CAMERA.zoomDefault;
    this.targetZoom = CAMERA.zoomDefault;

    // Screen dimensions (logical, not physical)
    this.screenW = 0;
    this.screenH = 0;
    this.dpr = 1;

    // Shake
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeIntensity = 0;
    this.shakeDuration = 0;

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.screenW = window.innerWidth;
    this.screenH = window.innerHeight;
    this.canvas.width = this.screenW * this.dpr;
    this.canvas.height = this.screenH * this.dpr;
    this.canvas.style.width = this.screenW + 'px';
    this.canvas.style.height = this.screenH + 'px';
  }

  /** Set camera target to follow entity. */
  follow(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  /** Set camera target with velocity-based pan-ahead. */
  followAhead(x, y, vx, vy, panFactor = 0.3) {
    this.targetX = x + vx * panFactor;
    this.targetY = y + vy * panFactor;
  }

  /** Set zoom target. */
  setZoom(z) {
    this.targetZoom = Math.max(CAMERA.zoomMin, Math.min(CAMERA.zoomMax, z));
  }

  /** Add screen shake. */
  shake(intensity, duration) {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
  }

  /** Update camera (call once per sim tick). */
  tick(dt) {
    // Smooth follow
    this.x = lerp(this.x, this.targetX, CAMERA.lerpSpeed);
    this.y = lerp(this.y, this.targetY, CAMERA.lerpSpeed);

    // Smooth zoom
    this.zoom = lerp(this.zoom, this.targetZoom, CAMERA.zoomLerp);

    // Screen shake
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      const t = this.shakeDuration > 0 ? 1 : 0;
      this.shakeX = (Math.random() - 0.5) * this.shakeIntensity * t * 2;
      this.shakeY = (Math.random() - 0.5) * this.shakeIntensity * t * 2;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Begin camera transform (call before drawing world). */
  begin(ctx) {
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(this.screenW / 2 + this.shakeX, this.screenH / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /** End camera transform (call after drawing world). */
  end(ctx) {
    ctx.restore();
  }

  /** World coords -> screen coords. */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.screenW / 2 + this.shakeX,
      y: (wy - this.y) * this.zoom + this.screenH / 2 + this.shakeY,
    };
  }

  /** Screen coords -> world coords. */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.screenW / 2 - this.shakeX) / this.zoom + this.x,
      y: (sy - this.screenH / 2 - this.shakeY) / this.zoom + this.y,
    };
  }

  /** Get visible world bounds. */
  getVisibleBounds() {
    const halfW = this.screenW / 2 / this.zoom;
    const halfH = this.screenH / 2 / this.zoom;
    return {
      left: this.x - halfW,
      right: this.x + halfW,
      top: this.y - halfH,
      bottom: this.y + halfH,
    };
  }

  /** Check if world position is visible (with margin). */
  isVisible(wx, wy, margin = 64) {
    const b = this.getVisibleBounds();
    return wx > b.left - margin && wx < b.right + margin &&
           wy > b.top - margin && wy < b.bottom + margin;
  }

  /** Clear canvas with background color. */
  clear(ctx, color = '#1a1a0a') {
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.screenW, this.screenH);
    ctx.restore();
  }
}
