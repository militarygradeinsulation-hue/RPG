import * as THREE from 'three';

export interface CameraInputDelta {
  yawDelta: number;
  pitchDelta: number;
  zoomDelta: number;
}

/**
 * Unified keyboard + drag-mouse + pointer-lock + multi-touch input controller.
 * Supports mouse-drag orbit, pointer-lock, 1-finger touch look, 2-finger pinch zoom,
 * and virtual touch stick / hold inputs for mobile gameplay.
 */
export class InputManager {
  public readonly keys: Record<string, boolean> = {};
  public isPointerLocked = false;
  public isDragging = false;

  // Virtual touch controls state (driven by MobileTouchControls)
  public virtualMoveX = 0;
  public virtualMoveY = 0;
  public virtualSprint = false;
  public virtualBlock = false;
  public virtualAscend = false;
  public virtualDive = false;

  private lastX = 0;
  private lastY = 0;
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingZoom = 0;
  private enabled = false;
  private rightMouseDown = false;
  private lastPointerWasTouch = false;
  private activePointers = new Map<number, { x: number; y: number; pointerType: string }>();
  private lastPinchDist: number | null = null;
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
      this.activePointers.clear();
      this.lastPinchDist = null;
      this.pendingYaw = 0;
      this.pendingPitch = 0;
      this.pendingZoom = 0;
      this.clearVirtualInputs();
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

  public setVirtualMove(x: number, y: number, sprint?: boolean): void {
    this.virtualMoveX = THREE.MathUtils.clamp(x, -1, 1);
    this.virtualMoveY = THREE.MathUtils.clamp(y, -1, 1);
    if (sprint !== undefined) {
      this.virtualSprint = sprint;
    }
    this.callbacks.onFirstGesture();
  }

  public setVirtualHold(kind: 'sprint' | 'block' | 'ascend' | 'dive', active: boolean): void {
    if (kind === 'sprint') this.virtualSprint = active;
    else if (kind === 'block') this.virtualBlock = active;
    else if (kind === 'ascend') this.virtualAscend = active;
    else if (kind === 'dive') this.virtualDive = active;
    if (active) this.callbacks.onFirstGesture();
  }

  public clearVirtualInputs(): void {
    this.virtualMoveX = 0;
    this.virtualMoveY = 0;
    this.virtualSprint = false;
    this.virtualBlock = false;
    this.virtualAscend = false;
    this.virtualDive = false;
  }

  public isBlocking(): boolean {
    return Boolean(this.keys['KeyB'] || this.rightMouseDown || this.virtualBlock);
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
    if (this.lastPointerWasTouch || window.matchMedia?.('(pointer: coarse)').matches) return;
    try {
      void this.dom.requestPointerLock?.();
    } catch {
      // Pointer lock optional
    }
  }

  private computePinchDist(): number | null {
    if (this.activePointers.size < 2) return null;
    const pts = Array.from(this.activePointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
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
      this.activePointers.clear();
      this.lastPinchDist = null;
      this.clearVirtualInputs();
      Object.keys(this.keys).forEach((k) => {
        this.keys[k] = false;
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      this.callbacks.onFirstGesture();
      this.lastPointerWasTouch = e.pointerType === 'touch';

      if (e.pointerType === 'mouse') {
        if (e.button === 2) {
          this.rightMouseDown = true;
        }
        if (e.button !== 0 && e.button !== 2) return;
      }

      this.activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        pointerType: e.pointerType,
      });
      this.isDragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lastPinchDist = this.computePinchDist();
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
      if (!this.isDragging || !this.activePointers.has(e.pointerId)) return;

      const prev = this.activePointers.get(e.pointerId)!;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;

      if (this.activePointers.size >= 2) {
        const pinch = this.computePinchDist();
        if (pinch !== null && this.lastPinchDist !== null) {
          this.pendingZoom += (this.lastPinchDist - pinch) * 0.038;
        }
        this.lastPinchDist = pinch;
        return;
      }

      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const isTouch = e.pointerType === 'touch';
      this.pendingYaw -= dx * (isTouch ? 0.0074 : 0.0062);
      this.pendingPitch += dy * (isTouch ? 0.0054 : 0.0044);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.rightMouseDown = false;
      }
      this.activePointers.delete(e.pointerId);
      this.isDragging = this.activePointers.size > 0;
      this.lastPinchDist = this.computePinchDist();
      if (this.activePointers.size === 1) {
        const remaining = Array.from(this.activePointers.values())[0];
        this.lastX = remaining.x;
        this.lastY = remaining.y;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!this.enabled || !this.callbacks.isPlaying()) return;
      e.preventDefault();
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
    window.addEventListener('pointercancel', onPointerUp);
    this.dom.addEventListener('wheel', onWheel, { passive: false });
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
      window.removeEventListener('pointercancel', onPointerUp);
      this.dom.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };
  }

  public dispose(): void {
    this.cleanupFn();
  }
}
