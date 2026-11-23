import * as THREE from 'three';
import type { EnvironmentId } from '../session/types.js';

/**
 * Milestone 1 environments:
 *  - void: dark and distraction-free, with dim fixed reference points (a floor
 *    ring and a horizon of faint dots) to support orientation.
 *  - grounding: a calm, static dusk landscape with a stable horizon.
 * Nothing moves in either environment. Both live in the rig, so they align
 * with the recentered view (no dependence on a physical horizon when reclining).
 */
export class EnvironmentManager {
  readonly root = new THREE.Group();
  private voidEnv = new THREE.Group();
  private groundEnv = new THREE.Group();
  current: EnvironmentId = 'grounding';

  constructor() {
    this.buildVoid();
    this.buildGrounding();
    this.root.add(this.voidEnv, this.groundEnv);
    this.set('grounding');
  }

  set(id: EnvironmentId): void {
    this.current = id;
    this.voidEnv.visible = id === 'void';
    this.groundEnv.visible = id === 'grounding';
  }

  private buildVoid(): void {
    const grid = new THREE.PolarGridHelper(6, 12, 5, 72, 0x2a3555, 0x1a2238);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.35;
    grid.position.y = -1.25;
    this.voidEnv.add(grid);

    const pts: number[] = [];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push(Math.sin(a) * 9, -0.05, -Math.cos(a) * 9);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.voidEnv.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x3a4670, size: 0.06 })));
  }

  private buildGrounding(): void {
    // Sky dome with a vertical gradient.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x101a3a) },
          mid: { value: new THREE.Color(0x3c4f7c) },
          bottom: { value: new THREE.Color(0xd9a077) },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;' +
          'void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.7, h)) : mix(bottom, mid, smoothstep(-0.02, 0.08, h));' +
          ' if (h < -0.02) c = vec3(0.10,0.13,0.14); gl_FragColor = vec4(c,1.0); }',
      }),
    );
    this.groundEnv.add(sky);

    // Ground.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: 0x1d2a26 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.25;
    this.groundEnv.add(ground);

    // Still lake.
    const lake = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x5b6f96 }));
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(16, 7, 1);
    lake.position.set(0, -1.24, -20);
    this.groundEnv.add(lake);

    // Distant mountain silhouettes (deterministic).
    const shape: number[] = [];
    const R = 55;
    const N = 90;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const h = 3 + rnd() * 7 + Math.sin(a0 * 3) * 2;
      const x0 = Math.sin(a0) * R;
      const z0 = -Math.cos(a0) * R;
      const x1 = Math.sin(a1) * R;
      const z1 = -Math.cos(a1) * R;
      const am = (a0 + a1) / 2;
      shape.push(x0, -1.25, z0, x1, -1.25, z1, Math.sin(am) * R, -1.25 + h, -Math.cos(am) * R);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(shape, 3));
    this.groundEnv.add(new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x232c45, side: THREE.DoubleSide })));

    // Soft low sun glow near the horizon.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,220,180,0.9)');
    grad.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sun.position.set(-25, 2, -60);
    sun.scale.setScalar(18);
    this.groundEnv.add(sun);
  }
}
