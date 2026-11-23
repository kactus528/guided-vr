import * as THREE from 'three';
import type { Settings } from '../settings/SettingsManager.js';

const DEG = Math.PI / 180;

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The luminous target. Lives inside the recentered rig, so it follows the
 * recentered view, not every head movement. Positions are placed on a sphere
 * around the head so the target keeps a constant distance and angular size.
 */
export class VisualStimulusController {
  readonly group = new THREE.Group();
  private core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private glow: THREE.Sprite;

  constructor() {
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }),
    );
    this.glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.group.add(this.glow, this.core);
    this.group.visible = false;
  }

  apply(s: Settings): void {
    const c = new THREE.Color(s.color);
    this.core.material.color.copy(c).multiplyScalar(s.brightness);
    this.glow.material.color.copy(c);
  }

  /** x, y normalised (see patterns.ts); alpha 0..1 for fade in/out. */
  place(x: number, y: number, s: Settings, alpha: number, brightness = s.brightness): void {
    const half = (s.width / 2) * DEG;
    const az = x * half;
    const el = y * half;
    const d = s.distance;
    this.group.position.set(d * Math.sin(az) * Math.cos(el), d * Math.sin(el), -d * Math.cos(az) * Math.cos(el));
    const r = d * Math.tan((s.size / 2) * DEG);
    this.core.scale.setScalar(r);
    this.glow.scale.setScalar(r * 7);
    this.core.material.opacity = alpha;
    this.glow.material.opacity = alpha * 0.55 * brightness;
  }

  show(v: boolean): void {
    this.group.visible = v;
  }
}
