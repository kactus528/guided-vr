import { getAudioContext, unlockAudio } from '../audio/audioContext.js';
import { MicrophoneRecorder } from '../audio/MicrophoneRecorder.js';
import { NarrationManager, type NarratorProfile } from '../audio/NarrationManager.js';
import { get as dbGet, uid } from '../data/db.js';
import { JournalManager, type RecordingRecord } from '../data/JournalManager.js';
import { EnvironmentManager } from '../env/EnvironmentManager.js';
import { GROUNDING_TEXT, GroundingManager, ORIENTATION_NARRATION } from '../safety/GroundingManager.js';
import { scoreItq, type ItqResult } from '../measures/itq.js';
import { FOLLOW_UP, GUIDED_SESSION, ITQ_SESSION, RESOURCE_SESSION } from '../session/definitions.js';
import { SessionEngine } from '../session/SessionEngine.js';
import type { Effect, FollowUpDue, SessionDefinition, SessionRecord, StepDef } from '../session/types.js';
import { SETTING_ROWS, SettingsManager, type Settings } from '../settings/SettingsManager.js';
import { AudioStimulusController } from '../stim/AudioStimulusController.js';
import { BilateralStimulationEngine, type StimLog } from '../stim/BilateralStimulationEngine.js';
import { HapticStimulusController } from '../stim/HapticStimulusController.js';
import { VisualStimulusController } from '../stim/VisualStimulusController.js';
import { DomUI } from '../ui/DomUI.js';
import { fmtSecs, Panel, type Block, type Btn, type PanelView } from '../ui/Panel.js';
import { XRExperienceManager } from '../xr/XRExperienceManager.js';

type Screen =
  | { name: 'menu' }
  | { name: 'session' }
  | { name: 'settings'; back: Screen }
  | { name: 'journal' }
  | { name: 'journalDetail'; id: string }
  | { name: 'confirmDeleteAll' }
  | { name: 'lab' }
  | { name: 'sanctuary' }
  | { name: 'grounding'; back: Screen }
  | { name: 'endConfirm'; back: Screen };

const STAGE_LABEL: Record<string, string> = {
  welcome: 'Welcome', preparation: 'Preparation', target: 'Choosing a focus', baseline: 'Baseline',
  activation: 'Optional activation', stimulation: 'Bilateral stimulation', checkin: 'Check-in',
  reflection: 'Reflection', integration: 'Positive belief', body: 'Body awareness', closure: 'Closure',
  summary: 'Summary', followup: 'Follow-up', grounding: 'Grounding',
};

const ENTRY_LABEL: Record<string, string> = {
  memory: 'Remembered experience', trigger: 'Present-day trigger', belief: 'Negative belief',
  pattern: 'Recurring pattern', reaction: 'Unexplained reaction',
};

interface VoiceClip {
  id: string;
  blob: Blob;
  seconds: number;
}

export class App {
  private xr: XRExperienceManager;
  private env = new EnvironmentManager();
  private panel = new Panel(1.1, 1280, 1024);
  private stimPanel = new Panel(0.62, 1000, 150);
  private visual = new VisualStimulusController();
  private haptics: HapticStimulusController;
  private audioCtl: AudioStimulusController | null = null;
  private stim: BilateralStimulationEngine;
  private settings = new SettingsManager();
  private narration: NarrationManager;
  private recorder = new MicrophoneRecorder();
  private journal = new JournalManager();
  private grounding: GroundingManager;

  private screen: Screen = { name: 'menu' };
  private engine: SessionEngine | null = null;
  private record: SessionRecord | null = null;
  private voice = new Map<string, VoiceClip>();
  private recordingMeta: { field: string; stepId: string; prompt: string } | null = null;
  private micDenied = false;
  private paused = false;
  private subtitle: string | null = null;
  private transientNote: string | null = null;
  private ticker: number | null = null;
  private stimContext: 'session' | 'lab' | null = null;
  private labLast: StimLog | null = null;
  private menuFollowUp: { session: SessionRecord; fu: FollowUpDue } | null = null;
  private itqHistory: SessionRecord[] = [];
  private journalList: SessionRecord[] = [];
  private detail: { rec: SessionRecord; clips: RecordingRecord[]; confirmDelete: boolean } | null = null;
  private playing: HTMLAudioElement | null = null;
  private vrSupported = false;
  private persistRequested = false;
  private dom: DomUI;
  private micGranted = false;
  private textSaveTimer: number | null = null;

  constructor(root: HTMLElement, uiRoot: HTMLElement) {
    this.xr = new XRExperienceManager(root);
    this.dom = new DomUI(uiRoot);
    this.haptics = new HapticStimulusController(() => this.xr.inputSources());
    this.stim = new BilateralStimulationEngine(this.visual, () => this.audio(), this.haptics);
    this.narration = new NarrationManager(
      this.settings,
      (profile: NarratorProfile, segment: string) =>
        dbGet<{ blob: Blob }>('narration', `${profile}:${segment}`).then((r) => r?.blob),
      (text) => {
        this.subtitle = text;
        this.render();
      },
    );
    this.grounding = new GroundingManager({
      stopVisual: () => this.stim.stop('grounding'),
      stopAudio: () => this.audioCtl?.stopAll(),
      stopHaptics: () => undefined, // haptic pulses are one-shot; stopping the engine stops new ones
      pauseNarrationAndRecording: async () => {
        this.narration.stop();
        if (this.recorder.recording) await this.finishRecording();
      },
      showGroundingEnvironment: () => this.env.set('grounding'),
      offerOptions: () => this.render(),
    });
  }

  async init(): Promise<void> {
    const rig = this.xr.rig;
    rig.add(this.env.root, this.visual.group, this.panel.mesh, this.stimPanel.mesh);
    this.panel.mesh.position.set(0, -0.08, -1.35);
    this.stimPanel.mesh.position.set(0, -0.62, -1.4);
    this.stimPanel.mesh.rotation.x = -0.35;
    this.stimPanel.mesh.visible = false;

    for (const p of [this.panel, this.stimPanel]) {
      p.onAction = (id) => this.handle(id);
      this.xr.addInteractive({ object: p.mesh, hover: (uv) => p.pointer(uv), click: (uv) => p.click(uv) });
    }

    this.xr.viewMode = this.settings.get().viewMode;
    this.settings.onChange((s) => {
      this.xr.viewMode = s.viewMode;
      this.visual.apply(s);
    });
    this.xr.onFrame = () => this.stim.update();
    this.xr.onUserGesture = () => unlockAudio();
    this.xr.onControllerCommand = (cmd) => (cmd === 'ground' ? this.groundNow() : this.xr.recenter());
    this.xr.onPresentChange = () => {
      this.updateHud();
      this.render();
    };
    this.recorder.onChange = () => this.updateHud();

    this.setupHud();
    this.vrSupported = await XRExperienceManager.vrSupported();
    await this.checkMic();
    this.updateHud();
    await this.showMenu();
    (window as unknown as { __gvrReady: boolean }).__gvrReady = true;
  }

  private audio(): AudioStimulusController | null {
    if (this.audioCtl) return this.audioCtl;
    const ctx = getAudioContext();
    if (!ctx) return null;
    this.audioCtl = new AudioStimulusController(ctx);
    return this.audioCtl;
  }

  // ================= DOM HUD (desktop) =================

  private setupHud(): void {
    this.dom.onAction = (id) => this.handle(id);
    this.dom.onText = (field, value) => {
      if (!this.engine) return;
      this.engine.setAnswer(field, value.trim() ? value : undefined);
      if (this.textSaveTimer) clearTimeout(this.textSaveTimer);
      this.textSaveTimer = window.setTimeout(() => void this.autosave(), 600);
    };
    this.dom.onTopbar = (cmd) => {
      unlockAudio();
      if (cmd === 'vr') void this.enterVR();
      else if (cmd === 'ground') this.groundNow();
      else if (cmd === 'home' && !this.engine) void this.showMenu();
      else if (cmd === 'home') this.toast('A session is in progress — use End to leave it.');
    };
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'g' || e.key === 'G' || e.key === 'Escape') this.groundNow();
      else if (e.key === 'r' || e.key === 'R') this.xr.recenter();
      else if (e.key === ' ' && this.screen.name === 'session') {
        e.preventDefault();
        this.togglePause();
      }
    });
  }

  private async enterVR(): Promise<void> {
    unlockAudio();
    try {
      await this.xr.enterVR();
    } catch (e) {
      this.toast(`Could not start VR: ${(e as Error).message}`);
    }
  }

  private async checkMic(): Promise<void> {
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      this.micGranted = st?.state === 'granted';
      if (st) st.onchange = () => {
        this.micGranted = st.state === 'granted';
        this.render();
      };
    } catch {
      this.micGranted = false;
    }
  }

  /** The headset can only show the microphone prompt outside VR, so offer it up front. */
  private async allowMic(): Promise<void> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      this.micGranted = true;
      this.micDenied = false;
      this.toast('Microphone allowed. Recordings stay on this device.');
    } catch {
      this.micDenied = true;
      this.toast('Microphone not allowed — you can still type or skip.');
    }
    this.render();
  }

  private updateHud(): void {
    this.dom.setTopbar({
      vrAvailable: this.vrSupported,
      presenting: this.xr.presenting,
      recording: this.recorder.recording,
      micNeeded: MicrophoneRecorder.supported() && !this.micGranted,
    });
  }

  private toast(msg: string): void {
    const t = document.getElementById('toast')!;
    t.textContent = msg;
    t.style.opacity = '1';
    setTimeout(() => (t.style.opacity = '0'), 4000);
  }

  private textNoteInVR(): void {
    this.transientNote = "Typing isn't available inside VR. Use voice, the options, or skip — or type later in the browser view.";
    this.render();
  }

  // ================= Routing =================

  private handle(id: string): void {
    unlockAudio();
    const [kind, a, b] = id.split('|');
    switch (kind) {
      case 'chip': return this.toggleChip(a, b);
      case 'choice': return this.choose(a, b);
      case 'rate': return this.rate(a, b);
      case 'text': return this.textNoteInVR();
      case 'voice': return void this.voiceCmd(a, b);
      case 'set': {
        this.settings.adjust(a as keyof Settings, b === 'inc' ? 1 : -1);
        return this.render();
      }
    }
    const ns = id.split(':')[0];
    const rest = id.slice(ns.length + 1);
    switch (ns) {
      case 'f': return this.footer(rest);
      case 'act': return this.sessionAction(rest);
      case 'menu': return void this.menuAction(rest);
      case 'g': return this.groundingAction(rest);
      case 'end': return this.endAction(rest);
      case 'settings': return this.settingsAction(rest);
      case 'journal': return void this.journalAction(rest);
      case 'lab': return this.labAction(rest);
      case 'stim': return this.stimAction(rest);
    }
  }

  private footer(cmd: string): void {
    switch (cmd) {
      case 'pause': return this.togglePause();
      case 'repeat': return this.narration.repeat();
      case 'recenter': return this.xr.recenter();
      case 'ground': return this.groundNow();
      case 'end': {
        this.screen = { name: 'endConfirm', back: this.screen };
        return this.render();
      }
    }
  }

  private standardFooter(): Btn[] {
    if (this.screen.name === 'session') {
      return [
        { id: 'f:pause', label: this.paused ? 'Resume' : 'Pause' },
        { id: 'f:repeat', label: 'Repeat', style: this.narration.hasLast ? 'normal' : 'disabled' },
        { id: 'f:recenter', label: 'Recenter' },
        { id: 'f:ground', label: 'Ground', style: 'primary' },
        { id: 'f:end', label: 'End', style: 'danger' },
      ];
    }
    return [
      { id: 'f:recenter', label: 'Recenter' },
      { id: 'f:ground', label: 'Ground', style: 'primary' },
    ];
  }

  // ================= Render =================

  private render(): void {
    const stim = this.stim.running;
    const vr = this.xr.presenting;
    this.panel.mesh.visible = vr && !stim;
    this.stimPanel.mesh.visible = vr && stim;
    this.updateHud();
    if (stim) {
      const sv = this.stimView();
      if (vr) this.stimPanel.setView(sv);
      this.dom.showStim(sv);
      return;
    }
    let v: PanelView;
    switch (this.screen.name) {
      case 'menu': v = this.menuView(); break;
      case 'session': v = this.sessionView(); break;
      case 'settings': v = this.settingsView(); break;
      case 'journal': v = this.journalView(); break;
      case 'journalDetail': v = this.detailView(); break;
      case 'confirmDeleteAll': v = this.confirmDeleteAllView(); break;
      case 'lab': v = this.labView(); break;
      case 'sanctuary': v = this.sanctuaryView(); break;
      case 'grounding': v = this.groundingView(); break;
      case 'endConfirm': v = this.endConfirmView(); break;
    }
    v.subtitle = this.subtitle;
    v.recording = this.recorder.recording;
    if (this.transientNote) v.blocks.unshift({ kind: 'note', text: this.transientNote, tone: 'warn' });
    if (vr) this.panel.setView(v);
    const key = `${this.screen.name}:${this.screen.name === 'session' ? this.engine?.current.id : ''}:${this.paused}`;
    this.dom.showPage(v, key);
  }

  private stimView(): PanelView {
    const lab = this.stimContext === 'lab';
    const p = this.stim.paused;
    const step = this.engine?.current;
    const label = lab ? 'Neutral practice' : step?.stim?.countsAsSet === false ? 'Practice set' : `Set ${(this.engine?.setCount ?? 0) + 1}`;
    return {
      blocks: [{
        kind: 'buttons', columns: 4, height: 78, items: [
          { id: 'stim:label', label: p ? `${label} · paused` : label, style: 'disabled' },
          { id: 'stim:pause', label: p ? 'Resume' : 'Pause' },
          { id: 'stim:stop', label: 'Stop set' },
          { id: 'stim:ground', label: 'Ground', style: 'primary' },
        ],
      }],
    };
  }

  // ================= Menu =================

  private async showMenu(): Promise<void> {
    this.screen = { name: 'menu' };
    this.env.set('grounding');
    this.paused = false;
    try {
      this.menuFollowUp = await this.journal.pendingFollowUp();
      this.itqHistory = (await this.journal.list()).filter((r) => r.definitionId === ITQ_SESSION.id && r.status === 'completed');
    } catch {
      this.menuFollowUp = null;
    }
    this.render();
  }

  private menuView(): PanelView {
    const later = (label: string, m: number): Btn => ({ id: `menu:later${m}`, label: `${label} · M${m}`, style: 'disabled' });
    const blocks: Block[] = [];
    if (this.menuFollowUp) {
      blocks.push({ kind: 'note', text: `A ${this.menuFollowUp.fu.kind === '24h' ? '24-hour' : '7-day'} follow-up check-in is available for your session on ${fmtDate(this.menuFollowUp.session.startedAt)}.` });
      blocks.push({ kind: 'buttons', columns: 1, height: 64, items: [{ id: 'menu:followup', label: 'Start follow-up check-in' }] });
    }
    if (!this.xr.presenting) {
      const hero: Btn[] = [];
      if (this.vrSupported) hero.push({ id: 'menu:vr', label: 'Enter VR', style: 'primary' });
      if (MicrophoneRecorder.supported() && !this.micGranted) hero.push({ id: 'menu:mic', label: 'Allow microphone' });
      blocks.push({
        kind: 'note',
        text: this.vrSupported
          ? 'Best in the headset. Everything also works here in the browser. Allow the microphone first if you want voice notes — the headset can only ask outside VR.'
          : 'Running in the browser. Open this page in the Quest browser to use it in VR.',
      });
      if (hero.length) blocks.push({ kind: 'buttons', columns: 2, height: 80, items: hero });
    }
    blocks.push({ kind: 'buttons', columns: 1, height: 96, items: [{ id: 'menu:guided', label: 'Begin Guided Session', style: this.vrSupported && !this.xr.presenting ? 'normal' : 'primary' }] });
    const lastItq = this.itqHistory[0];
    const itqDue = !lastItq || Date.now() - Date.parse(lastItq.startedAt) > 28 * 24 * 3600_000;
    blocks.push({
      kind: 'buttons', columns: 2, height: 66, items: [
        { id: 'menu:resource', label: 'Resource & Stabilization' },
        { id: 'menu:itq', label: lastItq ? `Monthly questionnaire${itqDue ? ' · due' : ''}` : 'Monthly questionnaire (ITQ)' },
      ],
    });
    blocks.push({
      kind: 'buttons', columns: 2, height: 62, items: [
        { id: 'menu:sanctuary', label: 'Grounding Sanctuary' },
        { id: 'menu:lab', label: 'Bilateral Stimulation Lab' },
        { id: 'menu:journal', label: 'Session Journal' },
        { id: 'menu:settings', label: 'Settings' },
        later('Voice Studio', 2),
        later('Emotional Pattern Map', 3),
        later('Experimental Flicker Lab', 5),
        later('Research Dashboard', 5),
      ],
    });
    blocks.push({ kind: 'lines', size: 22, lines: ['Private and experimental. Not a diagnostic tool or a validated EMDR treatment, and not a substitute for trauma therapy. Everything stays on this device.'] });
    return { header: 'Guided VR Emotional Reprocessing', title: 'Main menu', blocks, footer: this.standardFooter() };
  }

  private async menuAction(a: string): Promise<void> {
    switch (a) {
      case 'guided': return this.startSession(GUIDED_SESSION);
      case 'resource': return this.startSession(RESOURCE_SESSION);
      case 'itq': return this.startSession(ITQ_SESSION);
      case 'followup':
        if (this.menuFollowUp) return this.startSession(FOLLOW_UP, this.menuFollowUp.session, this.menuFollowUp.fu);
        return;
      case 'sanctuary':
        this.screen = { name: 'sanctuary' };
        this.env.set('grounding');
        return this.render();
      case 'lab':
        this.screen = { name: 'lab' };
        this.env.set('void');
        return this.render();
      case 'journal': return this.openJournal();
      case 'settings':
        this.screen = { name: 'settings', back: this.screen };
        return this.render();
      case 'back':
        return this.showMenu();
      case 'vr':
        return this.enterVR();
      case 'mic':
        return this.allowMic();
    }
  }

  // ================= Session lifecycle =================

  private async startSession(def: SessionDefinition, parent?: SessionRecord, fu?: FollowUpDue): Promise<void> {
    unlockAudio();
    if (!this.persistRequested && navigator.storage?.persist) {
      this.persistRequested = true;
      void navigator.storage.persist().catch(() => false);
    }
    const engine = new SessionEngine(def);
    if (parent) engine.answers.parentDate = fmtDate(parent.startedAt);
    if (fu) engine.answers.followUpKind = fu.kind;
    if (def.id === GUIDED_SESSION.id) engine.answers.processingStyle = this.settings.get().processingStyle;
    this.record = {
      id: uid('ses'),
      definitionId: def.id,
      definitionVersion: def.version,
      parentId: parent?.id,
      startedAt: new Date().toISOString(),
      status: 'in-progress',
      answers: engine.answers,
      ratings: [],
      sets: [],
      events: [],
      stepTrail: [],
      stimLocked: false,
    };
    this.engine = engine;
    if (def.id === ITQ_SESSION.id) {
      this.itqHistory = (await this.journal.list().catch(() => [] as SessionRecord[]))
        .filter((r) => r.definitionId === ITQ_SESSION.id && r.status === 'completed');
    }
    this.voice.clear();
    this.paused = false;
    this.grounding.uses = 0;
    this.screen = { name: 'session' };
    engine.onStep((step, effects) => this.onStepEnter(step, effects));
    engine.start();
  }

  private onStepEnter(step: StepDef, effects: Effect[]): void {
    const rec = this.record!;
    if (this.recorder.recording) void this.finishRecording();
    this.narration.stop();
    this.narration.clearLast();
    this.transientNote = null;
    rec.stepTrail.push({ stepId: step.id, at: new Date().toISOString() });
    if (effects.includes('lockStim') && !rec.stimLocked) {
      rec.events.push({ type: 'stim-locked', stepId: step.id, at: now() });
      if (step.id === 'orientation') rec.events.push({ type: 'disorientation-reported', stepId: step.id, at: now() });
    }
    rec.stimLocked = this.engine!.stimLocked;
    void this.autosave();
    // While the grounding overlay is up, only bookkeeping happens.
    if (this.screen.name === 'session') this.presentStep();
  }

  /** Show (and narrate / start) the current step. */
  private presentStep(): void {
    const step = this.engine!.current;
    this.env.set(step.environment ?? 'void');
    if (step.type === 'stimulation') {
      this.startSet(step);
      return;
    }
    this.render();
    if (step.narration && !this.paused) void this.narration.say(step.narration.segment, this.engine!.template(step.narration.text));
  }

  private startSet(step: StepDef): void {
    const s = this.settings.snapshot();
    if (step.stim?.speed) s.speed = step.stim.speed;
    const duration = step.stim?.duration ?? s.setDuration;
    this.stimContext = 'session';
    this.paused = false;
    this.stim.start(s, duration, step.id, (log) => this.onSetEnd(log));
    this.render();
  }

  private onSetEnd(log: StimLog): void {
    this.stimContext = null;
    if (this.record) {
      this.record.sets.push({ ...log, countsAsSet: this.engine?.current.stim?.countsAsSet !== false });
    }
    this.engine?.stimulationEnded();
    this.render();
  }

  private sessionView(): PanelView {
    const e = this.engine!;
    const step = e.current;
    const header = `${STAGE_LABEL[step.stage] ?? ''}${e.setCount ? ` · ${e.setCount} set${e.setCount > 1 ? 's' : ''}` : ''}`;
    if (this.paused) {
      return {
        header, title: 'Paused', body: 'Take whatever time you need.',
        blocks: [{ kind: 'buttons', items: [{ id: 'f:pause', label: 'Resume', style: 'primary' }, { id: 'f:ground', label: 'Ground' }, { id: 'f:end', label: 'End session', style: 'danger' }] }],
      };
    }
    if (step.type === 'summary') return { header, title: step.title, blocks: [...this.summaryBlocks(), this.actionsBlock(step)], footer: this.standardFooter() };

    const blocks: Block[] = [];
    const seen = new Set<string>();
    for (const n of step.notes ?? []) {
      const text = e.template(n.text);
      if (e.evaluate(n.when) && !seen.has(text)) {
        seen.add(text);
        blocks.push({ kind: 'note', text, tone: n.tone });
      }
    }
    for (const inp of e.visibleInputs()) {
      const field = e.resolveField(inp.field);
      const label = inp.label ? e.template(inp.label) : undefined;
      const val = e.getAnswer(field);
      switch (inp.kind) {
        case 'choice':
          blocks.push({ kind: 'choice', field, label, options: inp.options, selected: val as string | undefined, stacked: inp.autoAdvance });
          break;
        case 'chips':
          blocks.push({ kind: 'chips', field, label, items: inp.items, selected: Array.isArray(val) ? (val as string[]) : val ? [String(val)] : [] });
          break;
        case 'rating':
          blocks.push({ kind: 'rating', field, label: label ?? '', min: inp.min, max: inp.max, minLabel: inp.minLabel, maxLabel: inp.maxLabel, value: typeof val === 'number' ? val : undefined });
          break;
        case 'text':
          blocks.push({
            kind: 'text', field, label, value: typeof val === 'string' ? val : '', placeholder: inp.placeholder,
            disabledText: this.xr.presenting ? 'Typing is available in the desktop view' : undefined,
          });
          break;
        case 'voice': {
          const clip = this.voice.get(field);
          const state = !MicrophoneRecorder.supported() ? 'unsupported'
            : this.micDenied ? 'denied'
              : this.recordingMeta?.field === field ? 'recording'
                : clip ? 'recorded' : 'idle';
          blocks.push({ kind: 'voice', field, label, state, seconds: state === 'recording' ? this.recorder.elapsedS : clip?.seconds });
          break;
        }
      }
    }
    if (step.actions?.length) blocks.push(this.actionsBlock(step));
    return { header, title: e.template(step.title), body: e.bodyFor(step), blocks, footer: this.standardFooter() };
  }

  private actionsBlock(step: StepDef): Block {
    const items = (step.actions ?? []).map((a) => ({ id: `act:${a.id}`, label: a.label, style: a.style ?? 'normal' }));
    return { kind: 'buttons', items, columns: items.length > 3 ? 2 : items.length, height: 70 };
  }

  private summaryBlocks(): Block[] {
    const id = this.engine!.def.id;
    if (id === ITQ_SESSION.id) return this.itqBlocks();
    if (id === RESOURCE_SESSION.id) return this.resourceBlocks();
    return this.guidedSummaryBlocks();
  }

  private itqBlocks(): Block[] {
    const r: ItqResult = scoreItq(this.engine!.answers);
    const lines = [
      `PTSD symptoms: ${r.ptsdTotal} / 24  (re-experiencing ${r.clusters.Re}, avoidance ${r.clusters.Av}, sense of threat ${r.clusters.Th})`,
      `Self-organisation difficulties: ${r.dsoTotal} / 24  (emotion regulation ${r.clusters.AD}, self-concept ${r.clusters.NSC}, relationships ${r.clusters.DR})`,
    ];
    const screenText: Record<ItqResult['screen'], string> = {
      none: 'Screening result: below the threshold for probable PTSD or complex PTSD.',
      PTSD: 'Screening result: consistent with probable PTSD (ICD-11).',
      CPTSD: 'Screening result: consistent with probable complex PTSD (ICD-11).',
      incomplete: 'Some questions were skipped, so no screening result is given. The totals above count skipped items as 0.',
    };
    lines.push(screenText[r.screen]);
    const prev = this.itqHistory.slice(0, 5).map((h) => {
      const p = scoreItq(h.answers);
      return `${fmtDate(h.startedAt)} — PTSD ${p.ptsdTotal}, self-organisation ${p.dsoTotal}`;
    });
    const blocks: Block[] = [{ kind: 'lines', lines }];
    if (prev.length) blocks.push({ kind: 'lines', size: 22, lines: ['Previous results:', ...prev] });
    blocks.push({
      kind: 'note',
      text: 'This is a self-report screen, not a diagnosis. Scores move for many reasons, so look at the trend over months rather than any single result. If the scores are high or rising, that is worth talking through with a trauma-informed clinician.',
    });
    return blocks;
  }

  private resourceBlocks(): Block[] {
    const e = this.engine!;
    const a = e.answers;
    const kind: Record<string, string> = { place: 'Calm or safe place', presence: 'Caring presence', mastery: 'Time I felt capable', quality: 'A quality', nature: 'Nature, music, or art' };
    const strengths = Object.keys(a).filter((k) => /^res_strength_\d+$/.test(k)).sort((x, y) => Number(x.split('_')[2]) - Number(y.split('_')[2])).map((k) => a[k]);
    const lines = [
      `Resource: ${kind[String(a.resourceType)] ?? '–'}`,
      `Short sets: ${e.setCount}`,
    ];
    if (strengths.length) lines.push(`Positive feeling: ${strengths.join(' → ')} (0–10)`);
    if (a.res_cue) lines.push(`Cue word: "${String(a.res_cue)}"`);
    const negatives = Object.keys(a).filter((k) => k.startsWith('res_check_') && a[k] === 'negative').length;
    if (negatives) lines.push(`Set aside ${negatives} resource${negatives > 1 ? 's' : ''} that turned upsetting.`);
    return [{ kind: 'lines', lines }];
  }

  private guidedSummaryBlocks(): Block[] {
    const e = this.engine!;
    const rec = this.record!;
    const a = e.answers;
    const lines: string[] = [];
    const pick = (...f: string[]) => {
      for (const k of f) {
        const v = a[k];
        if (Array.isArray(v) && v.length) return v.join(', ');
        if (typeof v === 'string' && v && !v.startsWith('rec_')) return v;
      }
      return null;
    };
    if (a.entryPoint) lines.push(`Starting point: ${ENTRY_LABEL[String(a.entryPoint)] ?? a.entryPoint}`);
    const emo = pick('emotions', 'emotions_text');
    if (emo) lines.push(`Feelings: ${emo}`);
    const neg = pick('negBelief', 'negBelief_text');
    if (neg) lines.push(`Belief: "${neg}"`);
    const pos = pick('posBelief', 'posBelief_text');
    if (pos) lines.push(`Preferred belief: "${pos}"`);
    const suds = rec.ratings.filter((r) => r.field.startsWith('sud_'));
    const sudStart = a.sud_0;
    const sudEnd = a.sud_end ?? (suds.length ? suds[suds.length - 1].value : undefined);
    if (sudStart !== undefined || sudEnd !== undefined) lines.push(`Distress: ${sudStart ?? '–'} at start → ${sudEnd ?? '–'} now (0–10)`);
    if (a.voc_0 !== undefined || a.voc_end !== undefined) lines.push(`Preferred belief felt true: ${a.voc_0 ?? '–'} → ${a.voc_end ?? '–'} (1–7)`);
    lines.push(`Stimulation sets: ${e.setCount}`);
    const clips = this.voice.size;
    if (clips) lines.push(`Voice recordings: ${clips}`);
    if (this.grounding.uses) lines.push(`Grounding used: ${this.grounding.uses}×`);
    if (e.stimLocked) lines.push('Stimulation was stopped for the rest of the session after a check-in.');
    return [
      { kind: 'lines', lines },
      { kind: 'note', text: "These are in-the-moment ratings. They can shift for many reasons and don't show lasting change. You'll be offered optional check-ins after about 24 hours and 7 days, the next time you open the app." },
    ];
  }

  private sessionAction(actionId: string): void {
    const e = this.engine;
    if (!e) return;
    const effects = e.act(actionId);
    for (const fx of effects) {
      switch (fx) {
        case 'recenter': this.xr.recenter(); break;
        case 'settings':
          this.screen = { name: 'settings', back: { name: 'session' } };
          this.render();
          break;
        case 'menu': void this.abandonSession(); break;
        case 'exitXR': this.xr.exitVR(); break;
        case 'endNow': void this.finishSession('ended-early'); break;
        case 'complete': void this.finishSession('completed'); break;
        case 'lockStim': break;
      }
    }
  }

  private toggleChip(field: string, value: string): void {
    const e = this.engine;
    if (!e) return;
    const inp = e.visibleInputs().find((i) => e.resolveField(i.field) === field);
    const multi = inp?.kind === 'chips' && inp.multi;
    const cur = e.getAnswer(field);
    if (multi) {
      const arr = Array.isArray(cur) ? [...(cur as string[])] : [];
      const i = arr.indexOf(value);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(value);
      e.setAnswer(field, arr);
    } else {
      e.setAnswer(field, cur === value ? undefined : value);
    }
    void this.autosave();
    this.render();
  }

  private choose(field: string, value: string): void {
    const e = this.engine;
    if (!e) return;
    const inp = e.visibleInputs().find((i) => e.resolveField(i.field) === field);
    const numeric = inp?.kind === 'choice' && inp.numeric;
    e.setAnswer(field, numeric ? Number(value) : value);
    if (numeric && this.record) this.record.ratings.push({ field, value: Number(value), stepId: e.current.id, at: now() });
    void this.autosave();
    if (inp?.kind === 'choice' && inp.autoAdvance) e.advance();
    else this.render();
  }

  private rate(field: string, v: string): void {
    const e = this.engine;
    if (!e || !this.record) return;
    if (v === 'clear') e.setAnswer(field, undefined);
    else {
      const n = Number(v);
      e.setAnswer(field, n);
      this.record.ratings.push({ field, value: n, stepId: e.current.id, at: now() });
    }
    void this.autosave();
    this.render();
  }

  private togglePause(): void {
    if (this.screen.name !== 'session') return;
    this.paused = !this.paused;
    if (this.paused) {
      this.record?.events.push({ type: 'pause', stepId: this.engine?.current.id, at: now() });
      this.stim.pause();
      this.narration.pause();
    } else {
      this.stim.resume();
      this.narration.resume();
    }
    this.render();
  }

  private stimAction(a: string): void {
    switch (a) {
      case 'pause':
        if (this.stimContext === 'lab') {
          if (this.stim.paused) this.stim.resume();
          else this.stim.pause();
          return this.render();
        }
        return this.togglePause();
      case 'stop':
        this.paused = false;
        this.stim.stop('user-stopped');
        return;
      case 'ground':
        return this.groundNow();
    }
  }

  private async autosave(): Promise<void> {
    if (!this.record) return;
    try {
      await this.journal.save(structuredClone(this.record));
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  }

  private async abandonSession(): Promise<void> {
    const rec = this.record;
    const hasData = rec && (Object.keys(rec.answers).some((k) => !['parentDate', 'followUpKind', 'processingStyle'].includes(k)) || rec.sets.length > 0 || this.voice.size > 0);
    if (rec && !hasData) {
      await this.journal.deleteSession(rec.id).catch(() => undefined);
      this.clearSession();
      return this.showMenu();
    }
    return this.finishSession('ended-early');
  }

  private clearSession(): void {
    this.engine = null;
    this.record = null;
    this.voice.clear();
    this.paused = false;
    this.grounding.release();
  }

  private async finishSession(status: 'completed' | 'ended-early'): Promise<void> {
    const rec = this.record;
    const e = this.engine;
    this.stim.stop('session-ended');
    this.narration.stop();
    if (this.recorder.recording) await this.finishRecording();
    if (rec && e) {
      rec.status = status;
      rec.endedAt = now();
      rec.stimLocked = e.stimLocked;
      if (status === 'ended-early') rec.events.push({ type: 'ended-early', stepId: e.current.id, at: now() });
      if (rec.definitionId === GUIDED_SESSION.id && (status === 'completed' || e.setCount > 0)) {
        rec.followUps = JournalManager.followUpsFor(Date.now());
      }
      await this.autosave();
      if (rec.definitionId === FOLLOW_UP.id && rec.parentId) {
        const parent = await this.journal.get(rec.parentId);
        const kind = rec.answers.followUpKind;
        const fu = parent?.followUps?.find((f) => f.kind === kind);
        if (parent && fu) {
          fu.done = true;
          fu.followUpSessionId = rec.id;
          await this.journal.save(parent);
        }
      }
    }
    this.clearSession();
    await this.showMenu();
  }

  // ================= Voice =================

  private async voiceCmd(field: string, cmd: string): Promise<void> {
    if (!this.engine || !this.record) return;
    if (cmd === 'record' || cmd === 'redo') {
      if (cmd === 'redo') await this.deleteVoice(field);
      if (this.recorder.recording) await this.finishRecording();
      this.narration.stop(); // narration waits while the user speaks
      this.playing?.pause();
      try {
        this.recordingMeta = { field, stepId: this.engine.current.id, prompt: this.engine.template(this.engine.current.title) };
        await this.recorder.start();
        this.micGranted = true;
        this.ticker = window.setInterval(() => this.render(), 500);
      } catch (err) {
        this.recordingMeta = null;
        if ((err as Error).name === 'NotAllowedError' && this.xr.presenting && !this.micGranted) {
          this.transientNote = 'The headset can only ask for the microphone outside VR. Exit VR, choose "Allow microphone" on the main menu, then come back — or skip for now.';
        } else if ((err as Error).name === 'NotAllowedError') this.micDenied = true;
        else this.transientNote = `Microphone unavailable: ${(err as Error).message}`;
      }
      return this.render();
    }
    if (cmd === 'stop') return this.finishRecording();
    if (cmd === 'play') {
      const clip = this.voice.get(field);
      if (!clip) return;
      this.playing?.pause();
      this.narration.stop();
      const el = new Audio(URL.createObjectURL(clip.blob));
      this.playing = el;
      el.onended = () => URL.revokeObjectURL(el.src);
      void el.play().catch(() => undefined);
      return;
    }
    if (cmd === 'delete') {
      await this.deleteVoice(field);
      this.render();
    }
  }

  private async finishRecording(): Promise<void> {
    const meta = this.recordingMeta;
    this.recordingMeta = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    const res = await this.recorder.stop();
    if (res && meta && this.record && this.engine) {
      const id = uid('rec');
      const ratingsSnapshot: Record<string, number> = {};
      for (const [k, v] of Object.entries(this.engine.answers)) if (typeof v === 'number') ratingsSnapshot[k] = v;
      try {
        await this.journal.saveRecording({
          id, sessionId: this.record.id, stepId: meta.stepId, field: meta.field, prompt: meta.prompt,
          createdAt: now(), mime: res.mime, durationMs: res.durationMs, blob: res.blob, ratingsSnapshot,
        });
      } catch (e) {
        this.transientNote = 'The recording could not be saved to this device.';
        console.warn(e);
      }
      this.voice.set(meta.field, { id, blob: res.blob, seconds: res.durationMs / 1000 });
      this.engine.setAnswer(meta.field, id);
      void this.autosave();
    }
    this.render();
  }

  private async deleteVoice(field: string): Promise<void> {
    const clip = this.voice.get(field);
    if (!clip) return;
    await this.journal.deleteRecording(clip.id).catch(() => undefined);
    this.voice.delete(field);
    this.engine?.setAnswer(field, undefined);
    void this.autosave();
  }

  // ================= Grounding / end =================

  private groundNow(): void {
    if (this.screen.name === 'grounding') return;
    const back = this.screen.name === 'endConfirm' ? this.screen.back : this.screen;
    this.screen = { name: 'grounding', back };
    this.paused = false;
    this.narration.resume(); // clear any paused TTS state before stopping it
    this.record?.events.push({ type: 'grounding', stepId: this.engine?.current.id, at: now() });
    void this.grounding.engage();
  }

  private groundingView(): PanelView {
    const inSession = !!this.engine;
    const closing = this.engine?.def.closingStep;
    const cur = this.engine?.current;
    const atClosing = !closing || cur?.id === closing || cur?.type === 'summary' || cur?.id === 'body_end';
    const items: Btn[] = inSession
      ? [
        { id: 'g:return', label: 'Return to session', style: 'primary' },
        { id: 'g:orient', label: 'Orientation guide' },
        ...(!atClosing ? [{ id: 'g:closing', label: 'Go to closing' }] : []),
        { id: 'g:exitvr', label: 'Exit VR', style: this.xr.presenting ? 'normal' : 'disabled' } as Btn,
        { id: 'g:end', label: 'End session', style: 'danger' },
      ]
      : [
        { id: 'g:return', label: 'Back', style: 'primary' },
        { id: 'g:orient', label: 'Orientation guide' },
        { id: 'g:exitvr', label: 'Exit VR', style: this.xr.presenting ? 'normal' : 'disabled' },
      ];
    const blocks: Block[] = [];
    if (inSession) blocks.push({ kind: 'note', text: 'Nothing restarts automatically. Returning takes you to a check-in, not into stimulation.' });
    blocks.push({ kind: 'buttons', items, columns: 2, height: 70 });
    return {
      header: 'Grounding',
      title: "You're safe to pause here",
      body: this.fillDate(GROUNDING_TEXT),
      blocks,
      footer: [{ id: 'f:recenter', label: 'Recenter' }],
    };
  }

  private groundingAction(a: string): void {
    if (this.screen.name !== 'grounding') return;
    const back = this.screen.back;
    switch (a) {
      case 'return':
        this.grounding.release();
        this.narration.stop();
        this.screen = back.name === 'grounding' ? { name: 'menu' } : back;
        if (this.screen.name === 'session' && this.engine) {
          this.presentReturn();
          return;
        }
        if (this.screen.name === 'menu') return void this.showMenu();
        this.env.set(this.screen.name === 'lab' ? 'void' : 'grounding');
        return this.render();
      case 'orient':
        this.record?.events.push({ type: 'orientation', at: now() });
        void this.narration.say('orientation-guide', this.fillDate(ORIENTATION_NARRATION));
        return;
      case 'closing':
        this.grounding.release();
        this.screen = { name: 'session' };
        if (this.engine?.def.closingStep) this.engine.enter(this.engine.def.closingStep);
        return;
      case 'exitvr':
        return this.xr.exitVR();
      case 'end':
        this.grounding.release();
        return void this.finishSession('ended-early');
    }
  }

  /** Back from grounding into the session — never straight into stimulation. */
  private presentReturn(): void {
    const e = this.engine!;
    if (e.current.type === 'stimulation') {
      // A set that was interrupted has already advanced the engine; if not, move on without restarting.
      e.stimulationEnded();
      return;
    }
    this.presentStep();
  }

  private endConfirmView(): PanelView {
    const closing = this.engine?.def.closingStep;
    const cur = this.engine?.current;
    const offerClosing = !!closing && cur?.id !== closing && cur?.type !== 'summary' && this.engine?.def.id !== ITQ_SESSION.id;
    const items: Btn[] = [
      ...(offerClosing ? [{ id: 'end:closing', label: 'Brief closing first', style: 'primary' } as Btn] : []),
      { id: 'end:now', label: 'End now', style: 'danger' },
      { id: 'end:back', label: 'Go back' },
    ];
    return { title: 'End the session?', body: 'What you have entered so far is already saved on this device.', blocks: [{ kind: 'buttons', items, columns: items.length }] };
  }

  private endAction(a: string): void {
    if (this.screen.name !== 'endConfirm') return;
    const back = this.screen.back;
    if (a === 'back') {
      this.screen = back;
      return this.render();
    }
    if (a === 'now') return void this.finishSession('ended-early');
    if (a === 'closing') {
      this.stim.stop('ended-to-closing');
      this.screen = { name: 'session' };
      if (this.engine?.def.closingStep) this.engine.enter(this.engine.def.closingStep);
    }
  }

  private fillDate(text: string): string {
    const d = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return text.replace(/\{\{date\}\}/g, d);
  }

  // ================= Settings =================

  private settingsView(): PanelView {
    const rows = SETTING_ROWS.map((r) => ({ key: r.key, label: r.label, value: this.settings.display(r) }));
    const s = this.settings.get();
    const blocks: Block[] = [{ kind: 'settings', rows }];
    if (s.hapticsOn && this.xr.presenting && !this.haptics.available()) {
      blocks.push({ kind: 'note', text: 'No haptic-capable controllers detected. Everything else works without haptics.' });
    }
    if (s.pattern === 'arc') blocks.push({ kind: 'note', text: 'The arc pattern is experimental and nonstandard.', tone: 'warn' });
    blocks.push({ kind: 'lines', size: 21, lines: ['Changes apply from the next set. About 1 cycle per second with short sets is an illustrative research-reference setting, not a prescription.'] });
    blocks.push({
      kind: 'buttons', columns: 3, items: [
        { id: 'settings:testsound', label: 'Test sound L → R' },
        { id: 'settings:recenter', label: 'Recenter view' },
        { id: 'settings:done', label: 'Done', style: 'primary' },
      ],
    });
    return { header: 'Settings', title: 'Stimulation & comfort', blocks };
  }

  private settingsAction(a: string): void {
    if (a === 'recenter') return this.xr.recenter();
    if (a === 'testsound') {
      unlockAudio();
      const au = this.audio();
      if (!au) return this.toast('Web Audio is not available.');
      const s = this.settings.get();
      au.beat('L', au.currentTime + 0.1, s.tone, s.volume);
      au.beat('R', au.currentTime + 0.7, s.tone, s.volume);
      return;
    }
    if (a === 'done' && this.screen.name === 'settings') {
      const back = this.screen.back;
      this.screen = back;
      if (back.name === 'session') return this.render();
      if (back.name === 'menu') return void this.showMenu();
      return this.render();
    }
  }

  // ================= Lab (neutral only) =================

  private labView(): PanelView {
    const blocks: Block[] = [
      { kind: 'note', text: 'Neutral practice only — no emotional material. Use it to find a comfortable speed, width and sound.' },
    ];
    if (this.labLast) {
      const l = this.labLast;
      blocks.push({
        kind: 'lines', size: 23, lines: [
          `Last set: ${l.actualDuration.toFixed(1)} s of ${l.alignedDuration.toFixed(1)} s · ${l.beats} beats (${l.audioBeats} audio, ${l.hapticBeats} haptic)`,
          `Frame time: avg ${l.avgFrameMs.toFixed(1)} ms (${l.avgFrameMs ? (1000 / l.avgFrameMs).toFixed(0) : '–'} fps) · worst ${l.maxFrameMs.toFixed(1)} ms`,
        ],
      });
    }
    blocks.push({
      kind: 'buttons', columns: 3, items: [
        { id: 'lab:start', label: 'Start neutral set', style: 'primary' },
        { id: 'lab:settings', label: 'Settings' },
        { id: 'lab:back', label: 'Back to menu' },
      ],
    });
    return { header: 'Bilateral Stimulation Lab', title: 'Neutral practice', blocks, footer: this.standardFooter() };
  }

  private labAction(a: string): void {
    if (a === 'start') {
      unlockAudio();
      this.stimContext = 'lab';
      this.stim.start(this.settings.snapshot(), this.settings.get().setDuration, 'lab-neutral', (log) => {
        this.stimContext = null;
        this.labLast = log;
        this.render();
      });
      return this.render();
    }
    if (a === 'settings') {
      this.screen = { name: 'settings', back: { name: 'lab' } };
      return this.render();
    }
    if (a === 'back') void this.showMenu();
  }

  // ================= Sanctuary =================

  private sanctuaryView(): PanelView {
    return {
      header: 'Grounding Sanctuary',
      title: 'A quiet place',
      body: 'Nothing here moves and nothing is asked of you. Rest your eyes on the horizon, notice your breath, and stay as long as you like.\n\n(The full mountain-lake Sanctuary arrives in Milestone 4.)',
      blocks: [{
        kind: 'buttons', columns: 2, items: [
          { id: 'g:orient', label: 'Orientation guide' },
          { id: 'menu:back', label: 'Back to menu', style: 'primary' },
        ],
      }],
      footer: [{ id: 'f:recenter', label: 'Recenter' }],
    };
  }

  // ================= Journal =================

  private async openJournal(): Promise<void> {
    try {
      this.journalList = await this.journal.list();
    } catch {
      this.journalList = [];
    }
    this.screen = { name: 'journal' };
    this.env.set('grounding');
    this.render();
  }

  private journalView(): PanelView {
    const list = this.journalList.slice(0, 7);
    const items: Btn[] = list.map((s) => ({ id: `journal:open:${s.id}`, label: sessionLabel(s) }));
    const blocks: Block[] = [];
    if (!items.length) blocks.push({ kind: 'lines', lines: ['No sessions yet.'] });
    else blocks.push({ kind: 'buttons', columns: 1, height: 56, items });
    if (this.journalList.length > list.length) blocks.push({ kind: 'lines', size: 21, lines: [`Showing the ${list.length} most recent of ${this.journalList.length}. Export includes everything.`] });
    blocks.push({
      kind: 'note',
      text: 'Stored only in this browser on this device (IndexedDB). It is not encrypted, and clearing site data or browser storage pressure can delete it. Export to keep a copy. Nothing is uploaded.',
    });
    blocks.push({
      kind: 'buttons', columns: 3, items: [
        { id: 'journal:export', label: 'Export all (JSON)' },
        { id: 'journal:deleteall', label: 'Delete all data', style: 'danger' },
        { id: 'journal:back', label: 'Back', style: 'primary' },
      ],
    });
    return { header: 'Session Journal', title: 'Your sessions', blocks };
  }

  private async journalAction(a: string): Promise<void> {
    const [cmd, id] = [a.split(':')[0], a.split(':').slice(1).join(':')];
    switch (cmd) {
      case 'back': return this.showMenu();
      case 'open': {
        const rec = this.journalList.find((s) => s.id === id);
        if (!rec) return;
        const clips = await this.journal.recordingsFor(rec.id).catch(() => []);
        this.detail = { rec, clips, confirmDelete: false };
        this.screen = { name: 'journalDetail', id };
        return this.render();
      }
      case 'export': {
        if (this.xr.presenting) this.toast('Export downloads a file — it works best from the desktop view.');
        const blob = await this.journal.exportAll();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `gvr-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      case 'deleteall':
        this.screen = { name: 'confirmDeleteAll' };
        return this.render();
      case 'confirmdeleteall':
        await this.journal.deleteAll();
        return this.openJournal();
      case 'cancel':
        return this.openJournal();
      case 'play': {
        const clip = this.detail?.clips.find((c) => c.id === id);
        if (!clip) return;
        this.playing?.pause();
        const el = new Audio(URL.createObjectURL(clip.blob));
        this.playing = el;
        void el.play().catch(() => undefined);
        return;
      }
      case 'delete': {
        if (!this.detail) return;
        if (!this.detail.confirmDelete) {
          this.detail.confirmDelete = true;
          return this.render();
        }
        await this.journal.deleteSession(this.detail.rec.id);
        this.detail = null;
        return this.openJournal();
      }
    }
  }

  private detailView(): PanelView {
    const d = this.detail!;
    const r = d.rec;
    const a = r.answers;
    const lines: string[] = [
      `${fmtDate(r.startedAt)} · ${({ [FOLLOW_UP.id]: 'Follow-up', [ITQ_SESSION.id]: 'Monthly questionnaire', [RESOURCE_SESSION.id]: 'Resource session' } as Record<string, string>)[r.definitionId] ?? 'Guided session'} · ${r.status}`,
    ];
    if (r.definitionId === ITQ_SESSION.id) {
      const q = scoreItq(a);
      lines.push(`PTSD symptoms ${q.ptsdTotal}/24 · self-organisation ${q.dsoTotal}/24 · screen: ${q.screen}`);
    }
    if (a.entryPoint) lines.push(`Starting point: ${ENTRY_LABEL[String(a.entryPoint)] ?? a.entryPoint}`);
    for (const [k, label] of [['emotions', 'Feelings'], ['negBelief', 'Belief'], ['posBelief', 'Preferred belief'], ['situation_text', 'Notes'], ['fu_aftereffects', 'Aftereffects']] as const) {
      const v = a[k];
      if (v) lines.push(`${label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    }
    const ratings = r.ratings.map((x) => `${x.field}=${x.value}`).join('  ');
    if (ratings) lines.push(`Ratings: ${ratings}`);
    const sets = (r.sets as StimLog[]).filter((s) => s.mode === 'stim' || s.mode === 'res_stim');
    if (sets.length) lines.push(`Sets: ${sets.map((s) => `${s.actualDuration.toFixed(0)}s${s.completed ? '' : '*'}`).join(', ')}  (* stopped early)`);
    const g = r.events.filter((e) => e.type === 'grounding').length;
    if (g) lines.push(`Grounding used ${g}×`);
    if (r.stimLocked) lines.push('Stimulation was stopped after a check-in.');

    const clipBtns: Btn[] = d.clips.slice(0, 6).map((c) => ({ id: `journal:play:${c.id}`, label: `▶ ${c.prompt.slice(0, 28)} (${fmtSecs(c.durationMs / 1000)})` }));
    const blocks: Block[] = [{ kind: 'lines', size: 24, lines }];
    if (clipBtns.length) blocks.push({ kind: 'buttons', columns: 2, height: 56, items: clipBtns });
    blocks.push({
      kind: 'buttons', columns: 2, items: [
        { id: 'journal:delete', label: d.confirmDelete ? 'Tap again to delete permanently' : 'Delete this session', style: 'danger' },
        { id: 'journal:cancel', label: 'Back to journal', style: 'primary' },
      ],
    });
    return { header: 'Session Journal', title: 'Session details', blocks };
  }

  private confirmDeleteAllView(): PanelView {
    return {
      title: 'Delete all data?',
      body: 'This permanently removes every session, rating and voice recording stored by this app on this device. Settings are kept.',
      blocks: [{
        kind: 'buttons', columns: 2, items: [
          { id: 'journal:confirmdeleteall', label: 'Delete everything', style: 'danger' },
          { id: 'journal:cancel', label: 'Cancel', style: 'primary' },
        ],
      }],
    };
  }
}

// ---------- helpers ----------

function now(): string {
  return new Date().toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function sessionLabel(s: SessionRecord): string {
  const type = s.definitionId === FOLLOW_UP.id ? 'Follow-up' : s.definitionId === ITQ_SESSION.id ? 'Questionnaire'
    : s.definitionId === RESOURCE_SESSION.id ? 'Resource' : 'Guided';
  if (type === 'Questionnaire') {
    const r = scoreItq(s.answers);
    return `${fmtDate(s.startedAt)} · ITQ · PTSD ${r.ptsdTotal}, self-org ${r.dsoTotal}${s.status === 'completed' ? '' : ' · unfinished'}`;
  }
  const sets = (s.sets as { mode?: string }[]).filter((x) => x.mode === 'stim' || x.mode === 'res_stim').length;
  const a = s.answers;
  const sud = a.sud_0 !== undefined || a.sud_end !== undefined ? ` · distress ${a.sud_0 ?? '–'}→${a.sud_end ?? '–'}` : '';
  const status = s.status === 'completed' ? '' : s.status === 'in-progress' ? ' · interrupted' : ' · ended early';
  return `${fmtDate(s.startedAt)} · ${type}${type === 'Guided' || type === 'Resource' ? ` · ${sets} set${sets === 1 ? '' : 's'}` : ''}${sud}${status}`;
}

