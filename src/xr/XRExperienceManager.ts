import * as THREE from 'three';
import type { ViewMode } from '../settings/SettingsManager.js';

export interface Interactive {
  object: THREE.Mesh;
  hover(uv: THREE.Vector2 | null): void;
  click(uv: THREE.Vector2): void;
}

interface Ctrl {
  ray: THREE.Group;
  line: THREE.Line;
  source: XRInputSource | null;
  hit: { target: Interactive; uv: THREE.Vector2 } | null;
  prevButtons: boolean[];
}

/**
 * Renderer, scene, desktop preview and WebXR session handling.
 *
 * Everything the user looks at lives inside `rig`. Recentering moves the rig
 * to the current head pose (yaw only when seated, full orientation when
 * reclining), so content is aligned with the recentered view but does not
 * follow every head movement.
 */
export class XRExperienceManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  readonly rig = new THREE.Group();
  private interactives: Interactive[] = [];
  private raycaster = new THREE.Raycaster();
  private ctrls: Ctrl[] = [];
  private mouse = new THREE.Vector2();
  private mouseInside = false;
  private desktopHit: { target: Interactive; uv: THREE.Vector2 } | null = null;
  private yaw = 0;
  private pitch = 0;
  private drag: { x: number; y: number; moved: boolean; yaw: number; pitch: number } | null = null;
  private pendingRecenter = 0;
  private lastT = 0;
  viewMode: ViewMode = 'seated';

  onFrame: (dt: number) => void = () => {};
  onPresentChange: (presenting: boolean) => void = () => {};
  /** Controller button edge events: 'ground' (B/Y), 'recenter' (thumbstick press). */
  onControllerCommand: (cmd: 'ground' | 'recenter') => void = () => {};
  onUserGesture: () => void = () => {};

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    // 'local' (not floor-based) so seated and reclining use work the same.
    this.renderer.xr.setReferenceSpaceType('local');
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x000000);
    this.scene.add(this.rig, this.camera);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupDesktopInput();
    this.setupControllers();

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.pendingRecenter = 4;
      this.onPresentChange(true);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.recenter();
      this.onPresentChange(false);
    });

    this.renderer.setAnimationLoop((t: number) => this.frame(t));
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  static async vrSupported(): Promise<boolean> {
    try {
      return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
    } catch {
      return false;
    }
  }

  async enterVR(): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR not available');
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking'],
    });
    this.renderer.xr.setFramebufferScaleFactor(1.0);
    await this.renderer.xr.setSession(session);
    // Target 72 Hz on Quest 2 where the runtime lets us choose.
    const s = session as XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> };
    if (s.supportedFrameRates && s.updateTargetFrameRate && Array.from(s.supportedFrameRates).includes(72)) {
      void s.updateTargetFrameRate(72).catch(() => undefined);
    }
  }

  exitVR(): void {
    void this.renderer.xr.getSession()?.end();
  }

  addInteractive(i: Interactive): void {
    this.interactives.push(i);
  }

  inputSources(): readonly XRInputSource[] {
    const s = this.renderer.xr.getSession();
    return s ? Array.from(s.inputSources) : [];
  }

  /** Align content with the current view. */
  recenter(): void {
    if (!this.presenting) {
      this.yaw = 0;
      this.pitch = 0;
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.rig.position.set(0, 0, 0);
      this.rig.quaternion.identity();
      return;
    }
    const cam = this.renderer.xr.getCamera();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.matrixWorld.decompose(pos, q, new THREE.Vector3());
    this.rig.position.copy(pos);
    if (this.viewMode === 'reclining') {
      this.rig.quaternion.copy(q);
    } else {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      this.rig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-fwd.x, -fwd.z));
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private setupDesktopInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e: PointerEvent) => {
      this.mouseInside = true;
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this.drag.moved = true;
        if (this.drag.moved) {
          this.yaw = this.drag.yaw + dx * 0.004;
          this.pitch = THREE.MathUtils.clamp(this.drag.pitch + dy * 0.004, -1.2, 1.2);
        }
      }
    });
    el.addEventListener('pointerleave', () => (this.mouseInside = false));
    el.addEventListener('pointerdown', (e: PointerEvent) => {
      this.onUserGesture();
      this.drag = { x: e.clientX, y: e.clientY, moved: false, yaw: this.yaw, pitch: this.pitch };
    });
    el.addEventListener('pointerup', () => {
      if (this.drag && !this.drag.moved && this.desktopHit) this.desktopHit.target.click(this.desktopHit.uv);
      this.drag = null;
    });
  }

  private setupControllers(): void {
    for (let i = 0; i < 2; i++) {
      const ray = this.renderer.xr.getController(i);
      const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.55 }));
      line.scale.z = 3;
      ray.add(line);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      dot.name = 'cursor';
      dot.visible = false;
      this.scene.add(dot);
      const c: Ctrl = { ray, line, source: null, hit: null, prevButtons: [] };
      ray.addEventListener('connected', (e: { data?: XRInputSource }) => {
        c.source = e.data ?? null;
        line.visible = c.source?.targetRayMode === 'tracked-pointer';
      });
      ray.addEventListener('disconnected', () => {
        c.source = null;
        c.hit = null;
      });
      ray.addEventListener('selectstart', () => {
        this.onUserGesture();
        if (c.hit) c.hit.target.click(c.hit.uv);
      });
      (ray as THREE.Object3D).userData.cursor = dot;
      this.scene.add(ray);
      this.ctrls.push(c);
    }
  }

  private raycastFrom(origin: THREE.Vector3, dir: THREE.Vector3): { target: Interactive; uv: THREE.Vector2; dist: number } | null {
    this.raycaster.set(origin, dir);
    let best: { target: Interactive; uv: THREE.Vector2; dist: number } | null = null;
    for (const it of this.interactives) {
      if (!isVisible(it.object)) continue;
      const hit = this.raycaster.intersectObject(it.object, false)[0];
      if (hit?.uv && (!best || hit.distance < best.dist)) best = { target: it, uv: hit.uv.clone(), dist: hit.distance };
    }
    return best;
  }

  private frame(tms: number): void {
    const dt = this.lastT ? Math.min(0.1, (tms - this.lastT) / 1000) : 0;
    this.lastT = tms;

    if (this.pendingRecenter > 0 && --this.pendingRecenter === 0) this.recenter();

    const hovered = new Map<Interactive, THREE.Vector2 | null>();
    for (const it of this.interactives) hovered.set(it, null);

    if (this.presenting) {
      const m = new THREE.Matrix4();
      for (const c of this.ctrls) {
        const cursor = (c.ray.userData.cursor as THREE.Mesh);
        c.hit = null;
        cursor.visible = false;
        if (!c.source || c.source.targetRayMode !== 'tracked-pointer') continue;
        m.identity().extractRotation(c.ray.matrixWorld);
        const o = new THREE.Vector3().setFromMatrixPosition(c.ray.matrixWorld);
        const d = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
        const h = this.raycastFrom(o, d);
        c.line.scale.z = h ? h.dist : 3;
        if (h) {
          c.hit = { target: h.target, uv: h.uv };
          hovered.set(h.target, h.uv);
          cursor.position.copy(o).addScaledVector(d, h.dist - 0.005);
          cursor.visible = true;
        }
        this.pollButtons(c);
      }
    } else {
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.desktopHit = null;
      if (this.mouseInside && !this.drag?.moved) {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const h = this.raycastFrom(this.raycaster.ray.origin.clone(), this.raycaster.ray.direction.clone());
        if (h) {
          this.desktopHit = { target: h.target, uv: h.uv };
          hovered.set(h.target, h.uv);
        }
      }
      this.renderer.domElement.style.cursor = this.desktopHit ? 'pointer' : this.drag?.moved ? 'grabbing' : 'grab';
    }
    hovered.forEach((uv, it) => it.hover(uv));

    this.onFrame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private pollButtons(c: Ctrl): void {
    const gp = c.source?.gamepad;
    if (!gp) return;
    const pressed = gp.buttons.map((b: GamepadButton) => b.pressed);
    const edge = (i: number) => pressed[i] && !c.prevButtons[i];
    // xr-standard mapping: 3 = thumbstick press, 5 = B / Y.
    if (edge(5)) this.onControllerCommand('ground');
    if (edge(3)) this.onControllerCommand('recenter');
    c.prevButtons = pressed;
  }
}

function isVisible(o: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return true;
}
