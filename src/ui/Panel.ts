import * as THREE from 'three';

export type BtnStyle = 'primary' | 'normal' | 'danger' | 'disabled' | 'quiet';

export interface Btn {
  id: string;
  label: string;
  style?: BtnStyle;
}

export type Block =
  | { kind: 'buttons'; items: Btn[]; columns?: number; height?: number }
  | { kind: 'chips'; field: string; label?: string; items: string[]; selected: string[] }
  | { kind: 'choice'; field: string; label?: string; options: { value: string; label: string }[]; selected?: string; stacked?: boolean }
  | { kind: 'rating'; field: string; label: string; min: number; max: number; value?: number; minLabel?: string; maxLabel?: string }
  | { kind: 'text'; field: string; label?: string; value?: string; placeholder?: string; disabledText?: string }
  | { kind: 'voice'; field: string; label?: string; state: 'idle' | 'recording' | 'recorded' | 'unsupported' | 'denied'; seconds?: number }
  | { kind: 'settings'; rows: { key: string; label: string; value: string }[] }
  | { kind: 'lines'; lines: string[]; size?: number }
  | { kind: 'note'; text: string; tone?: 'info' | 'warn' }
  | { kind: 'spacer'; h: number };

export interface PanelView {
  header?: string;
  title?: string;
  body?: string;
  blocks: Block[];
  subtitle?: string | null;
  footer?: Btn[];
  recording?: boolean;
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  id: string;
  disabled?: boolean;
}

const C = {
  bg: 'rgba(14,18,30,0.94)',
  border: 'rgba(140,170,255,0.25)',
  text: '#e9edf6',
  dim: '#9aa6c0',
  primary: '#4d7cff',
  normal: '#2a3350',
  danger: '#7a2f3d',
  hover: 'rgba(255,255,255,0.14)',
  chipOn: '#2f9e86',
  warn: '#e9b44c',
  rec: '#ff4d5e',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * A world-space UI panel drawn to a canvas texture. Works identically with a
 * mouse on desktop and with controller rays in VR (hit-tested through UVs).
 * Hit ids: plain button ids, `chip|field|value`, `choice|field|value`,
 * `rate|field|n`, `text|field`, `voice|field|cmd`, `set|key|dec|inc`.
 */
export class Panel {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private hits: Hit[] = [];
  private hover: string | null = null;
  private view: PanelView = { blocks: [] };
  private pad = 44;
  onAction: (id: string) => void = () => {};

  constructor(readonly widthM: number, readonly pxW: number, readonly pxH: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tex.generateMipmaps = true;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    const h = (widthM * pxH) / pxW;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 10;
  }

  setView(v: PanelView): void {
    this.view = v;
    this.draw();
  }

  pointer(uv: THREE.Vector2 | null): void {
    const h = uv ? this.hitAt(uv) : null;
    const id = h && !h.disabled ? h.id : null;
    if (id !== this.hover) {
      this.hover = id;
      this.draw();
    }
  }

  click(uv: THREE.Vector2): void {
    const h = this.hitAt(uv);
    if (h && !h.disabled) this.onAction(h.id);
  }

  private hitAt(uv: THREE.Vector2): Hit | null {
    const x = uv.x * this.pxW;
    const y = (1 - uv.y) * this.pxH;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  // ---------- drawing ----------

  private rr(x: number, y: number, w: number, h: number, r: number): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  private font(px: number, weight = 400): void {
    this.g.font = `${weight} ${px}px ${FONT}`;
  }

  private wrap(text: string, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      if (!para) {
        out.push('');
        continue;
      }
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (this.g.measureText(test).width > maxW && line) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  private textBlock(text: string, x: number, y: number, maxW: number, px: number, color: string, weight = 400, lh = 1.35): number {
    this.font(px, weight);
    this.g.fillStyle = color;
    this.g.textBaseline = 'top';
    this.g.textAlign = 'left';
    for (const l of this.wrap(text, maxW)) {
      this.g.fillText(l, x, y);
      y += l ? px * lh : px * 0.6;
    }
    return y;
  }

  private button(b: Btn, x: number, y: number, w: number, h: number, px = 28): void {
    const g = this.g;
    const style = b.style ?? 'normal';
    const disabled = style === 'disabled';
    this.rr(x, y, w, h, 14);
    g.fillStyle = style === 'primary' ? C.primary : style === 'danger' ? C.danger : style === 'quiet' ? 'rgba(255,255,255,0.05)' : C.normal;
    if (disabled) g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fill();
    if (this.hover === b.id) {
      g.fillStyle = C.hover;
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 3;
      g.stroke();
    }
    this.font(px, style === 'primary' ? 600 : 500);
    g.fillStyle = disabled ? '#5c6680' : C.text;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = this.wrap(b.label, w - 24);
    const lh = px * 1.15;
    let ly = y + h / 2 - ((lines.length - 1) * lh) / 2;
    for (const l of lines) {
      g.fillText(l, x + w / 2, ly);
      ly += lh;
    }
    this.hits.push({ x, y, w, h, id: b.id, disabled });
  }

  private label(text: string | undefined, x: number, y: number, w: number): number {
    if (!text) return y;
    return this.textBlock(text, x, y, w, 26, C.dim, 500) + 6;
  }

  private draw(): void {
    const g = this.g;
    const W = this.pxW;
    const H = this.pxH;
    const pad = this.pad;
    const v = this.view;
    this.hits = [];
    g.clearRect(0, 0, W, H);
    this.rr(2, 2, W - 4, H - 4, 28);
    g.fillStyle = C.bg;
    g.fill();
    g.strokeStyle = C.border;
    g.lineWidth = 3;
    g.stroke();

    const cw = W - pad * 2;
    let y = pad - 8;

    if (v.header || v.recording) {
      this.font(22, 600);
      g.fillStyle = C.dim;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText((v.header ?? '').toUpperCase(), pad, y);
      if (v.recording) {
        g.fillStyle = C.rec;
        g.beginPath();
        g.arc(W - pad - 150, y + 11, 9, 0, Math.PI * 2);
        g.fill();
        g.fillText('RECORDING', W - pad - 134, y);
      }
      y += 36;
    }
    if (v.title) y = this.textBlock(v.title, pad, y, cw, 42, C.text, 700, 1.2) + 10;
    if (v.body) y = this.textBlock(v.body, pad, y, cw, 28, C.text, 400, 1.4) + 14;

    for (const b of v.blocks) y = this.drawBlock(b, pad, y, cw) + 16;

    // Subtitle + footer anchored to the bottom.
    const footH = v.footer?.length ? 64 : 0;
    let by = H - pad - footH;
    if (v.subtitle) {
      this.font(25, 400);
      const lines = this.wrap(v.subtitle, cw - 40);
      const sh = lines.length * 33 + 22;
      by -= sh + 14;
      this.rr(pad, by, cw, sh, 12);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fill();
      g.fillStyle = '#f4f1e6';
      g.textAlign = 'left';
      g.textBaseline = 'top';
      lines.forEach((l, i) => g.fillText(l, pad + 20, by + 11 + i * 33));
    }
    if (v.footer?.length) {
      const n = v.footer.length;
      const gap = 12;
      const bw = (cw - gap * (n - 1)) / n;
      v.footer.forEach((b, i) => this.button(b, pad + i * (bw + gap), H - pad - footH, bw, footH, 24));
    }
    this.tex.needsUpdate = true;
  }

  private drawBlock(b: Block, x: number, y: number, w: number): number {
    const g = this.g;
    switch (b.kind) {
      case 'spacer':
        return y + b.h;
      case 'note': {
        this.font(25, 500);
        const lines = this.wrap(b.text, w - 44);
        const h = lines.length * 33 + 22;
        this.rr(x, y, w, h, 12);
        g.fillStyle = b.tone === 'warn' ? 'rgba(233,180,76,0.16)' : 'rgba(120,160,255,0.12)';
        g.fill();
        g.fillStyle = b.tone === 'warn' ? C.warn : '#b9c8ff';
        g.fillRect(x, y, 6, h);
        g.textAlign = 'left';
        g.textBaseline = 'top';
        lines.forEach((l, i) => g.fillText(l, x + 24, y + 11 + i * 33));
        return y + h;
      }
      case 'lines': {
        const px = b.size ?? 27;
        for (const l of b.lines) y = this.textBlock(l, x, y, w, px, C.text, 400, 1.3) + 4;
        return y;
      }
      case 'buttons': {
        const n = b.items.length;
        const cols = b.columns ?? Math.min(n, n === 4 ? 2 : 3);
        const gap = 14;
        const h = b.height ?? 70;
        const bw = (w - gap * (cols - 1)) / cols;
        b.items.forEach((it, i) => {
          const r = Math.floor(i / cols);
          const c = i % cols;
          this.button(it, x + c * (bw + gap), y + r * (h + gap), bw, h);
        });
        return y + Math.ceil(n / cols) * (h + gap) - gap;
      }
      case 'chips':
      case 'choice': {
        y = this.label(b.label, x, y, w);
        const items = b.kind === 'chips' ? b.items.map((s) => ({ value: s, label: s })) : b.options;
        const sel = (val: string) => (b.kind === 'chips' ? b.selected.includes(val) : b.selected === val);
        const prefix = b.kind === 'chips' ? 'chip' : 'choice';
        const stacked = b.kind === 'choice' && b.stacked;
        const h = stacked ? 66 : 56;
        const px = stacked ? 28 : 25;
        this.font(px, 500);
        let cx = x;
        let cy = y;
        for (const it of items) {
          const iw = stacked ? w : Math.min(w, g.measureText(it.label).width + 48);
          if (!stacked && cx + iw > x + w) {
            cx = x;
            cy += h + 12;
          }
          const id = `${prefix}|${b.field}|${it.value}`;
          this.rr(cx, cy, iw, h, stacked ? 14 : h / 2);
          g.fillStyle = sel(it.value) ? C.chipOn : C.normal;
          g.fill();
          if (this.hover === id) {
            g.fillStyle = C.hover;
            g.fill();
            g.strokeStyle = 'rgba(255,255,255,0.6)';
            g.lineWidth = 3;
            g.stroke();
          }
          this.font(px, 500);
          g.fillStyle = C.text;
          g.textBaseline = 'middle';
          g.textAlign = stacked ? 'left' : 'center';
          g.fillText(it.label, stacked ? cx + 26 : cx + iw / 2, cy + h / 2);
          this.hits.push({ x: cx, y: cy, w: iw, h, id });
          if (stacked) cy += h + 12;
          else cx += iw + 12;
        }
        return stacked ? cy - 12 : cy + h;
      }
      case 'rating': {
        y = this.label(b.label, x, y, w);
        const n = b.max - b.min + 1;
        const gap = 8;
        const bw = Math.min(90, (w - gap * (n - 1)) / n);
        const h = 62;
        for (let i = 0; i < n; i++) {
          const val = b.min + i;
          const id = `rate|${b.field}|${val}`;
          const bx = x + i * (bw + gap);
          this.rr(bx, y, bw, h, 12);
          g.fillStyle = b.value === val ? C.chipOn : C.normal;
          g.fill();
          if (this.hover === id) {
            g.fillStyle = C.hover;
            g.fill();
          }
          this.font(28, 600);
          g.fillStyle = C.text;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(val), bx + bw / 2, y + h / 2);
          this.hits.push({ x: bx, y, w: bw, h, id });
        }
        const totalW = n * bw + (n - 1) * gap;
        this.font(21, 400);
        g.fillStyle = C.dim;
        g.textBaseline = 'top';
        g.textAlign = 'left';
        if (b.minLabel) g.fillText(b.minLabel, x, y + h + 6);
        g.textAlign = 'right';
        if (b.maxLabel) g.fillText(b.maxLabel, x + totalW, y + h + 6);
        const clearId = `rate|${b.field}|clear`;
        if (b.value !== undefined) {
          this.font(21, 500);
          g.textAlign = 'left';
          g.fillStyle = this.hover === clearId ? C.text : C.dim;
          g.fillText('clear', x + totalW + 16, y + h / 2 - 10);
          this.hits.push({ x: x + totalW + 8, y, w: 70, h, id: clearId });
        }
        return y + h + 30;
      }
      case 'text': {
        y = this.label(b.label, x, y, w);
        const h = 60;
        const id = `text|${b.field}`;
        this.rr(x, y, w, h, 12);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fill();
        g.strokeStyle = this.hover === id ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)';
        g.lineWidth = 2;
        g.stroke();
        this.font(25, 400);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        const shown = b.disabledText ?? (b.value || b.placeholder || 'Tap to type');
        g.fillStyle = b.value && !b.disabledText ? C.text : C.dim;
        let t = shown;
        while (g.measureText(t).width > w - 40 && t.length > 4) t = t.slice(0, -2);
        g.fillText(t === shown ? t : `${t}…`, x + 20, y + h / 2);
        this.hits.push({ x, y, w, h, id, disabled: !!b.disabledText });
        return y + h;
      }
      case 'voice': {
        y = this.label(b.label, x, y, w);
        const h = 60;
        const f = b.field;
        if (b.state === 'unsupported' || b.state === 'denied') {
          return this.textBlock(
            b.state === 'denied' ? 'Microphone permission was declined. You can still type or skip.' : 'Voice recording is not available in this browser.',
            x, y, w, 24, C.dim,
          );
        }
        const btns: Btn[] =
          b.state === 'idle' ? [{ id: `voice|${f}|record`, label: '●  Record' }]
            : b.state === 'recording' ? [{ id: `voice|${f}|stop`, label: '■  Stop', style: 'danger' }]
              : [
                { id: `voice|${f}|play`, label: '▶  Replay' },
                { id: `voice|${f}|redo`, label: '↻  Re-record' },
                { id: `voice|${f}|delete`, label: '✕  Delete', style: 'quiet' },
              ];
        const bw = 210;
        btns.forEach((bt, i) => this.button(bt, x + i * (bw + 12), y, bw, h, 25));
        const secs = b.seconds ?? 0;
        const tx = x + btns.length * (bw + 12) + 10;
        this.font(24, 500);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        if (b.state === 'recording') {
          g.fillStyle = C.rec;
          g.beginPath();
          g.arc(tx + 10, y + h / 2, 9, 0, Math.PI * 2);
          g.fill();
          g.fillText(`Recording ${fmtSecs(secs)}`, tx + 28, y + h / 2);
        } else if (b.state === 'recorded') {
          g.fillStyle = C.dim;
          g.fillText(`Saved · ${fmtSecs(secs)}`, tx, y + h / 2);
        }
        return y + h;
      }
      case 'settings': {
        const colW = (w - 30) / 2;
        const rh = 58;
        b.rows.forEach((r, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const rx = x + col * (colW + 30);
          const ry = y + row * (rh + 8);
          this.font(23, 500);
          g.fillStyle = C.dim;
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(r.label, rx, ry + rh / 2);
          const bx = rx + colW - 270;
          this.button({ id: `set|${r.key}|dec`, label: '−' }, bx, ry + 4, 50, rh - 8, 28);
          this.font(23, 600);
          g.fillStyle = C.text;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(r.value, bx + 135, ry + rh / 2);
          this.button({ id: `set|${r.key}|inc`, label: '+' }, bx + 220, ry + 4, 50, rh - 8, 28);
        });
        return y + Math.ceil(b.rows.length / 2) * (rh + 8);
      }
    }
  }
}

export function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}
