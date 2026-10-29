// Pointer-lock mouse, buttons, wheel and keyboard with per-frame "pressed" edges.
const BLOCKED = new Set(['F1', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backquote']);

export class Input {
  constructor(el) {
    this.el = el;
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.locked = false;
    this.onLockChange = null;

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.el;
      if (locked === this.locked) return;
      this.locked = locked;
      if (!locked) this.mouse.fill(false);
      if (this.onLockChange) this.onLockChange(locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += Math.max(-200, Math.min(200, e.movementX || 0));
      this.dy += Math.max(-200, Math.min(200, e.movementY || 0));
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      this.mouse[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.mouse[e.button] = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.fill(false);
    });
  }

  requestLock() {
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          try {
            const p2 = this.el.requestPointerLock();
            if (p2 && p2.catch) p2.catch(() => {});
          } catch {
            /* pointer lock unavailable */
          }
        });
      }
    } catch {
      /* pointer lock unavailable */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  shift() {
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight');
  }

  endFrame() {
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.pressed.clear();
    this.mousePressed.fill(false);
  }
}
