import type { Block, Btn, PanelView } from './Panel.js';
import { fmtSecs } from './Panel.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DomTopbar {
  vrAvailable: boolean;
  presenting: boolean;
  recording: boolean;
  micNeeded: boolean;
}

/**
 * The flat-browser interface: renders the same PanelView model the in-VR
 * panels use, as a normal web page (one narrow column, sticky action bar).
 * Ids on elements match Panel hit ids, so App handles both the same way.
 */
export class DomUI {
  private page: HTMLElement;
  private bar: HTMLElement;
  private stimBar: HTMLElement;
  private caption: HTMLElement;
  private lastKey = '';
  private lastHtml = '';
  onAction: (id: string) => void = () => {};
  onText: (field: string, value: string) => void = () => {};
  onTopbar: (cmd: 'vr' | 'ground' | 'home' | 'mic') => void = () => {};

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <header class="topbar">
        <button class="brand" data-top="home" type="button">Guided<span>VR</span></button>
        <span class="rec" hidden>● Recording</span>
        <span class="spacer"></span>
        <button class="chip" data-top="ground" type="button">Ground</button>
        <button class="go small" data-top="vr" type="button" hidden>Enter VR</button>
      </header>
      <div class="caption" hidden></div>
      <main class="page"></main>
      <div class="stimbar" hidden></div>`;
    this.bar = root.querySelector('.topbar')!;
    this.page = root.querySelector('.page')!;
    this.caption = root.querySelector('.caption')!;
    this.stimBar = root.querySelector('.stimbar')!;
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-id],[data-top]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      if (t.dataset.top) this.onTopbar(t.dataset.top as 'vr' | 'ground' | 'home' | 'mic');
      else if (t.dataset.id) this.onAction(t.dataset.id);
    });
    root.addEventListener('input', (e) => {
      const t = e.target as HTMLTextAreaElement;
      if (t.dataset.field) this.onText(t.dataset.field, t.value);
    });
  }

  setTopbar(t: DomTopbar): void {
    const vr = this.bar.querySelector<HTMLElement>('[data-top="vr"]')!;
    vr.hidden = !t.vrAvailable || t.presenting;
    this.bar.querySelector<HTMLElement>('.rec')!.hidden = !t.recording;
  }

  showStim(v: PanelView): void {
    this.root.classList.add('stimming');
    this.page.hidden = true;
    this.caption.hidden = true;
    this.stimBar.hidden = false;
    const btns = (v.blocks[0]?.kind === 'buttons' ? v.blocks[0].items : []) as Btn[];
    const html = `<span class="stimlabel">${esc(btns[0]?.label ?? '')}</span>${btns.slice(1).map((b) => this.btn(b, 'small')).join('')}`;
    if (this.stimBar.innerHTML !== html) this.stimBar.innerHTML = html;
    this.lastKey = '';
  }

  showPage(v: PanelView, key: string): void {
    this.root.classList.remove('stimming');
    this.page.hidden = false;
    this.stimBar.hidden = true;
    this.caption.hidden = !v.subtitle;
    if (v.subtitle) this.caption.textContent = v.subtitle;

    const html = this.pageHtml(v);
    if (html === this.lastHtml && key === this.lastKey) return;
    // Keep focus and caret if the user is typing in a field that survives the re-render.
    const active = document.activeElement as HTMLTextAreaElement | null;
    const focusField = active?.dataset?.field;
    const sel = focusField ? [active!.selectionStart, active!.selectionEnd] : null;
    const scroll = window.scrollY;
    this.page.innerHTML = html;
    this.lastHtml = html;
    if (key !== this.lastKey) window.scrollTo(0, 0);
    else window.scrollTo(0, scroll);
    this.lastKey = key;
    if (focusField) {
      const el = this.page.querySelector<HTMLTextAreaElement>(`[data-field="${CSS.escape(focusField)}"]`);
      if (el) {
        el.focus();
        if (sel) el.setSelectionRange(sel[0] ?? 0, sel[1] ?? 0);
      }
    }
  }

  private btn(b: Btn, extra = ''): string {
    const style = b.style ?? 'normal';
    const cls = style === 'primary' ? 'go' : style === 'danger' ? 'go danger' : 'go secondary';
    return `<button type="button" class="${cls} ${extra}" data-id="${esc(b.id)}"${style === 'disabled' ? ' disabled' : ''}>${esc(b.label)}</button>`;
  }

  private pageHtml(v: PanelView): string {
    const parts: string[] = ['<section class="screen">', '<div class="screen-head">'];
    if (v.header) parts.push(`<p class="eyebrow">${esc(v.header)}</p>`);
    if (v.title) parts.push(`<h2>${esc(v.title)}</h2>`);
    parts.push('</div>');
    if (v.body) {
      for (const para of v.body.split('\n\n')) {
        const lines = para.split('\n');
        if (lines.every((l) => l.startsWith('• '))) {
          parts.push(`<ul class="bullets">${lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`);
        } else parts.push(`<p class="lede">${lines.map(esc).join('<br>')}</p>`);
      }
    }
    for (const b of v.blocks) parts.push(this.block(b));
    parts.push('</section>');
    if (v.footer?.length) {
      parts.push(`<nav class="foot">${v.footer.map((b) => this.btn(b, 'small')).join('')}</nav>`);
    }
    return parts.join('');
  }

  private block(b: Block): string {
    switch (b.kind) {
      case 'spacer':
        return `<div style="height:${b.h / 3}px"></div>`;
      case 'note':
        return `<div class="note ${b.tone === 'warn' ? 'warn' : ''}">${esc(b.text)}</div>`;
      case 'lines':
        return `<div class="lines">${b.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
      case 'buttons': {
        const cols = b.items.length === 1 ? 1 : b.columns === 1 ? 1 : 2;
        return `<div class="btns cols${cols}">${b.items.map((it) => this.btn(it)).join('')}</div>`;
      }
      case 'chips':
        return `<div class="row">${b.label ? `<p class="lbl">${esc(b.label)}</p>` : ''}<div class="presets">${b.items
          .map((it) => `<button type="button" class="chip" aria-pressed="${b.selected.includes(it)}" data-id="${esc(`chip|${b.field}|${it}`)}">${esc(it)}</button>`)
          .join('')}</div></div>`;
      case 'choice':
        return `<div class="row">${b.label ? `<p class="${b.label.length > 40 ? 'q' : 'lbl'}">${esc(b.label)}</p>` : ''}<div class="${b.stacked ? 'options' : 'presets'}">${b.options
          .map((o) => `<button type="button" class="${b.stacked ? 'option' : 'chip'}" aria-pressed="${b.selected === o.value}" data-id="${esc(`choice|${b.field}|${o.value}`)}">${esc(o.label)}</button>`)
          .join('')}</div></div>`;
      case 'rating': {
        const cells: string[] = [];
        for (let n = b.min; n <= b.max; n++) {
          cells.push(`<button type="button" class="cell" aria-pressed="${b.value === n}" data-id="${esc(`rate|${b.field}|${n}`)}">${n}</button>`);
        }
        return `<div class="row"><p class="${b.label.length > 40 ? 'q' : 'lbl'}">${esc(b.label)}${b.value !== undefined ? ` <button type="button" class="linkbtn" data-id="${esc(`rate|${b.field}|clear`)}">clear</button>` : ''}</p>
          <div class="scale" style="--n:${b.max - b.min + 1}">${cells.join('')}</div>
          <div class="ends"><span>${esc(b.minLabel ?? '')}</span><span>${esc(b.maxLabel ?? '')}</span></div></div>`;
      }
      case 'text': {
        const label = (b.label ?? '').replace(/\s*\(desktop\)/i, '');
        if (b.secret) {
          return `<div class="row">${label ? `<p class="lbl">${esc(label)}</p>` : ''}<input type="password" autocomplete="off" data-field="${esc(b.field)}" placeholder="${esc(b.placeholder ?? '')}" value="${esc(b.value ?? '')}"></div>`;
        }
        if (b.field.startsWith('cfg:')) {
          return `<div class="row">${label ? `<p class="lbl">${esc(label)}</p>` : ''}<input type="text" autocomplete="off" data-field="${esc(b.field)}" placeholder="${esc(b.placeholder ?? '')}" value="${esc(b.value ?? '')}"></div>`;
        }
        return `<div class="row">${label ? `<p class="lbl">${esc(label)}</p>` : ''}<textarea rows="3" data-field="${esc(b.field)}" placeholder="${esc(b.placeholder ?? 'Optional')}">${esc(b.value ?? '')}</textarea></div>`;
      }
      case 'voice': {
        const f = b.field;
        const lbl = b.label ? `<p class="lbl">${esc(b.label)}</p>` : '';
        if (b.state === 'unsupported') return `<div class="row">${lbl}<p class="muted">Voice recording isn't available in this browser.</p></div>`;
        if (b.state === 'denied') return `<div class="row">${lbl}<p class="muted">Microphone permission was declined. You can type instead, or allow the microphone in the browser's site settings.</p></div>`;
        const id = (cmd: string) => esc(`voice|${f}|${cmd}`);
        const inner =
          b.state === 'idle' ? `<button type="button" class="go secondary small" data-id="${id('record')}">● Record</button>`
            : b.state === 'recording' ? `<button type="button" class="go rec on small" data-id="${id('stop')}">■ Stop</button><span class="recnow">Recording ${fmtSecs(b.seconds ?? 0)}</span>`
              : `<button type="button" class="go secondary small" data-id="${id('play')}">▶ Replay</button>
                 <button type="button" class="go secondary small" data-id="${id('redo')}">↻ Re-record</button>
                 <button type="button" class="chip" data-id="${id('delete')}">Delete</button>
                 <span class="muted">Saved · ${fmtSecs(b.seconds ?? 0)}</span>`;
        return `<div class="row">${lbl}<div class="recbar">${inner}</div></div>`;
      }
      case 'ai': {
        const talk =
          b.state === 'listening' ? `<button type="button" class="go rec on small" data-id="ai|stop">■ Done talking</button><span class="recnow">${esc(b.interim ? `“${b.interim}”` : 'Listening…')}</span>`
            : b.state === 'thinking' ? '<span class="muted">Thinking…</span>'
              : b.canVoice ? '<button type="button" class="go small" data-id="ai|talk">🎙 Talk to guide</button>' : '';
        return `<div class="aibox">
          <p class="eyebrow">AI guide</p>
          <div class="recbar">${talk}</div>
          ${b.you ? `<p class="muted">You: ${esc(b.you)}</p>` : ''}
          ${b.guide ? `<p class="guide">${esc(b.guide)}</p>` : ''}
          ${b.notice ? `<p class="aiwarn">${esc(b.notice)}</p>` : ''}
          ${b.hypothesis ? `<div class="hyp"><p><strong>Possible pattern</strong> <span class="muted">(a guess, not a fact)</span><br>${esc(b.hypothesis)}</p>
            <div class="recbar"><button type="button" class="go secondary small" data-id="ai|confirm">Yes, that fits — save it</button>
            <button type="button" class="chip" data-id="ai|dismiss">No, it doesn't</button></div></div>` : ''}
          <div class="aitype"><textarea rows="2" data-field="ai:draft" placeholder="Or type to the guide…">${esc(b.draft ?? '')}</textarea>
          <button type="button" class="go secondary small" data-id="ai|send"${b.state !== 'idle' ? ' disabled' : ''}>Send</button></div>
        </div>`;
      }
      case 'settings':
        return `<div class="settings">${b.rows
          .map((r) => `<div class="setrow"><span class="lbl">${esc(r.label)}</span>
            <button type="button" class="step" data-id="${esc(`set|${r.key}|dec`)}" aria-label="Decrease">−</button>
            <output>${esc(r.value)}</output>
            <button type="button" class="step" data-id="${esc(`set|${r.key}|inc`)}" aria-label="Increase">+</button></div>`)
          .join('')}</div>`;
    }
  }
}
