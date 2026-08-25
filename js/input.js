/**
 * Input system — mouse aim, keyboard, gamepad, touch.
 *
 * Mouse: cursor = fly direction (always). Click = fire.
 * Keyboard: WASD = move, Space = fire, Shift = cycle target.
 * Gamepad: left stick = move, right stick = aim, A = fire, LB = cycle target.
 * Touch: left half = virtual joystick, tap right = fire, target-cycle button.
 */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;

    // Movement vector (normalized -1 to 1)
    this.moveX = 0;
    this.moveY = 0;

    // Aim direction (normalized, from mouse or right stick)
    this.aimX = 0;
    this.aimY = 0;
    this.hasAim = false;

    // Mouse position in screen pixels
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseOnScreen = false;

    // Fire (held, not one-shot)
    this.fire = false;
    this.fireHeld = false;

    // Click-to-target
    this.clickTarget = false;
    this.clickTargetX = 0;
    this.clickTargetY = 0;

    // Cycle target / cycle target MODE / abandon (one-shot)
    this.cycleTarget = false;
    this.cycleMode = false;
    this.equipment = false;
    this.pause = false;
    this.abandon = false;

    // Settings
    this.autofire = false;
    this.clickToTarget = false;

    // Keyboard
    this.keys = {};

    // Touch
    this.joystickActive = false;
    this.joystickOrigin = { x: 0, y: 0 };
    this.joystickPos = { x: 0, y: 0 };
    this.touches = new Map();

    // Gamepad
    this.gamepadConnected = false;
    this._gpButtonsPrev = {};

    this._bindEvents();
  }

  _bindEvents() {
    const c = this.canvas;

    // ── Keyboard ──
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space') this.fire = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.cycleTarget = true;
      if (e.code === 'KeyV') this.cycleMode = true;
      if (e.code === 'KeyF') this.autofire = !this.autofire;
      if (e.code === 'KeyT') this.clickToTarget = !this.clickToTarget;
      if (e.code === 'KeyE') this.equipment = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pause = true;
      if (e.code === 'KeyQ') this.abandon = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // ── Mouse ──
    c.addEventListener('mousemove', (e) => {
      const rect = c.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.mouseOnScreen = true;
    });
    c.addEventListener('mouseleave', () => {
      this.mouseOnScreen = false;
    });
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.clickToTarget) {
        this.clickTargetX = e.clientX - c.getBoundingClientRect().left;
        this.clickTargetY = e.clientY - c.getBoundingClientRect().top;
        this.clickTarget = true;
      } else {
        this.fireHeld = true;
        this.fire = true;
      }
    });
    c.addEventListener('mouseup', () => {
      this.fireHeld = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── Touch ──
    c.addEventListener('touchstart', (e) => this._touchStart(e), { passive: false });
    c.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
    c.addEventListener('touchend', (e) => this._touchEnd(e), { passive: false });
    c.addEventListener('touchcancel', (e) => this._touchEnd(e), { passive: false });

    // ── Gamepad ──
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadConnected = true;
      console.log('[Input] Gamepad:', e.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = false;
    });
  }

  _touchStart(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    for (const t of e.changedTouches) {
      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      const norm = { x: x / rect.width, y: y / rect.height };
      this.touches.set(t.identifier, { x, y, norm });

      if (norm.x < 0.45) {
        // Left side = movement joystick
        this.joystickActive = true;
        this.joystickOrigin.x = x;
        this.joystickOrigin.y = y;
        this.joystickPos.x = x;
        this.joystickPos.y = y;
      } else if (norm.y < 0.3) {
        // Top-right = target cycle
        this.cycleTarget = true;
      } else if (norm.y < 0.42) {
        // Below it = target MODE cycle (next to the fire button)
        this.cycleMode = true;
      } else {
        // Rest of right side = fire
        this.fire = true;
      }
    }
  }

  _touchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const data = this.touches.get(t.identifier);
      if (!data) continue;
      const rect = this.canvas.getBoundingClientRect();
      data.x = t.clientX - rect.left;
      data.y = t.clientY - rect.top;
      data.norm = { x: data.x / rect.width, y: data.y / rect.height };
      if (this.joystickActive && data.norm.x < 0.45) {
        this.joystickPos.x = data.x;
        this.joystickPos.y = data.y;
      }
    }
  }

  _touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      this.touches.delete(t.identifier);
    }
    if (this.touches.size === 0) {
      this.joystickActive = false;
      this.moveX = 0;
      this.moveY = 0;
    }
  }

  /** Poll gamepad, combine all input sources, compute aim. */
  tick() {
    // ── Keep fire active while mouse/button held ──
    if (this.fireHeld) this.fire = true;
    // ── Gamepad polling ──
    if (this.gamepadConnected) {
      const gp = navigator.getGamepads()[0];
      if (gp) {
        // Left stick = movement
        this.moveX = Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0;
        this.moveY = Math.abs(gp.axes[1]) > 0.15 ? gp.axes[1] : 0;

        // Right stick = aim
        const rx = Math.abs(gp.axes[2]) > 0.2 ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > 0.2 ? gp.axes[3] : 0;
        if (rx !== 0 || ry !== 0) {
          this.aimX = rx;
          this.aimY = ry;
          this.hasAim = true;
        }

        // A button (0) or right trigger (7) = fire (held)
        const fireNow = gp.buttons[0]?.pressed || (gp.buttons[7]?.value > 0.5);
        if (fireNow) { this.fireHeld = true; this.fire = true; }
        else { this.fireHeld = false; }

        // LB (4) = cycle target, RB (5) = cycle target mode (rising edge)
        const cycleNow = gp.buttons[4]?.pressed;
        if (cycleNow && !this._gpButtonsPrev[4]) this.cycleTarget = true;
        this._gpButtonsPrev[4] = cycleNow;
        const modeNow = gp.buttons[5]?.pressed;
        if (modeNow && !this._gpButtonsPrev[5]) this.cycleMode = true;
        this._gpButtonsPrev[5] = modeNow;
      }
    }

    // ── Movement (left stick > joystick > WASD) ──
    if (!this.gamepadConnected || (this.moveX === 0 && this.moveY === 0)) {
      if (this.joystickActive) {
        const dx = this.joystickPos.x - this.joystickOrigin.x;
        const dy = this.joystickPos.y - this.joystickOrigin.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = 60;
        const clamped = Math.min(dist, maxDist);
        this.moveX = dist > 0 ? (dx / dist) * (clamped / maxDist) : 0;
        this.moveY = dist > 0 ? (dy / dist) * (clamped / maxDist) : 0;
      } else {
        this.moveX = 0;
        this.moveY = 0;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.moveX = -1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) this.moveX = 1;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) this.moveY = -1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) this.moveY = 1;
        const len = Math.hypot(this.moveX, this.moveY);
        if (len > 1) { this.moveX /= len; this.moveY /= len; }
      }
    }

    // ── Aim (mouse cursor always steers, unless gamepad right stick overrides) ──
    if (this.mouseOnScreen) {
      const cx = this.canvas.clientWidth / 2;
      const cy = this.canvas.clientHeight / 2;
      const dx = this.mouseX - cx;
      const dy = this.mouseY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 5) {
        this.aimX = dx / dist;
        this.aimY = dy / dist;
        this.hasAim = true;
      } else {
        this.hasAim = false;
      }
    } else if (!(this.gamepadConnected && (this.aimX !== 0 || this.aimY !== 0))) {
      // No mouse, no gamepad aim — aim in movement direction
      if (this.moveX !== 0 || this.moveY !== 0) {
        const len = Math.hypot(this.moveX, this.moveY);
        this.aimX = this.moveX / len;
        this.aimY = this.moveY / len;
        this.hasAim = true;
      } else {
        this.hasAim = false;
      }
    }
  }

  /** Reset one-shot inputs. */
  consumeOneShots() {
    this.fire = false;
    this.cycleTarget = false;
    this.cycleMode = false;
    this.clickTarget = false;
    this.equipment = false;
    this.pause = false;
    this.abandon = false;
  }

  /** Draw touch controls in screen space. */
  draw(ctx) {
    if (!this.joystickActive) return;
    const ox = this.joystickOrigin.x;
    const oy = this.joystickOrigin.y;
    const px = this.joystickPos.x;
    const py = this.joystickPos.y;

    ctx.strokeStyle = 'rgba(100,160,80,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 60, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(100,160,80,0.5)';
    ctx.beginPath();
    ctx.arc(px, py, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(100,160,80,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(px, py);
    ctx.stroke();
  }
}
