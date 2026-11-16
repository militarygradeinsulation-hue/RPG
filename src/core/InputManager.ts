import * as THREE from 'three';

export interface CameraInputDelta {
  yawDelta: number;
  pitchDelta: number;
  zoomDelta: number;
}

/**
 * Unified keyboard + drag-mouse + pointer-lock input controller.
 * Supports seamless switching between mouse-drag orbit and pointer-lock camera look.
 */
export class InputManager {
  public readonly keys: Record<string, boolean> = {};
  public isPointerLocked = false;
  public isDragging = false;
  private lastX = 0;
  private lastY = 0;
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingZoom = 0;
  private enabled = false;
  private rightMouseDown = false;
  private cleanupFn: () => void = () => {};

  constructor(
    private dom: HTMLElement,
    private callbacks: {
      isPlaying: () => boolean;
      onFirstGesture: () => void;
      onJump: () => void;
      onInteract: () => void;
      onMelee: () => void;
      onCastSpell: (element: 'fire' | 'lightning' | 'frost' | 'gale') => void;
      onDodge: () => void;
      onToggleAnchor: () => void;
      onToggleCrouch: () => void;
    }
  ) {
    this.bind();
  }

  public setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) {
      this.isDragging = false;
      this.rightMouseDown = false;
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
      if (document.pointerLockElement === this.dom) {
        try {
          document.exitPointerLock();
        } catch {
          // Ignore
        }
      }
    }
  }

  public isBlocking(): boolean {
    return Boolean(this.keys['KeyB'] || this.rightMouseDown);
  }

  public consumeCameraDelta(): CameraInputDelta {
    const out = {
      yawDelta: this.pendingYaw,
      pitchDelta: this.pendingPitch,
      zoomDelta: this.pendingZoom,
    };
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.pendingZoom = 0;
    return out;
  }

  public requestPointerLock(): void {
    if (!this.enabled || !this.callbacks.isPlaying()) return;
    try {
      void this.dom.requestPointerLock?.();
    } catch {
      // Pointer lock optional
    }
  }

  private bind() {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const wasDown = this.keys[e.code];
      this.keys[e.code] = true;
      this.callbacks.onFirstGesture();

      if (!wasDown) {
        if (e.code === 'Space') {
          e.preventDefault();
          this.callbacks.onJump();
        } else if (e.code === 'KeyE') {
          this.callbacks.onInteract();
        } else if (e.code === 'KeyJ') {
          this.callbacks.onMelee();
        } else if (e.code === 'Digit1') {
          this.callbacks.onCastSpell('fire');
        } else if (e.code === 'Digit2') {
          this.callbacks.onCastSpell('lightning');
        } else if (e.code === 'Digit3') {
          this.callbacks.onCastSpell('frost');
        } else if (e.code === 'Digit4') {
          this.callbacks.onCastSpell('gale');
        } else if (e.code === 'KeyV') {
          this.callbacks.onDodge();
        } else if (e.code === 'KeyF') {
          this.callbacks.onToggleAnchor();
        } else if (e.code === 'KeyC') {
          this.callbacks.onToggleCrouch();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };

    const onBlur = () => {
      this.isDragging = false;
      this.rightMouseDown = false;
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      this.callbacks.onFirstGesture();
      if (e.button === 2) {
        this.rightMouseDown = true;
      }
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    };

    const onDblClick = () => {
      this.requestPointerLock();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      if (document.pointerLockElement === this.dom) {
        this.pendingYaw -= THREE.MathUtils.clamp(e.movementX, -120, 120) * 0.0032;
        this.pendingPitch += THREE.MathUtils.clamp(e.movementY, -120, 120) * 0.0024;
        return;
      }
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.pendingYaw -= dx * 0.0062;
      this.pendingPitch += dy * 0.0044;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) this.rightMouseDown = false;
      this.isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      this.pendingZoom += e.deltaY * 0.012;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement === this.dom;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.dom.addEventListener('pointerdown', onPointerDown);
    this.dom.addEventListener('dblclick', onDblClick);
    this.dom.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.dom.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('pointerlockchange', onPointerLockChange);

    this.cleanupFn = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      this.dom.removeEventListener('pointerdown', onPointerDown);
      this.dom.removeEventListener('dblclick', onDblClick);
      this.dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      this.dom.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }

  public dispose(): void {
    this.cleanupFn();
  }
}
