const CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export interface RecordingResult {
  blob: Blob;
  mime: string;
  durationMs: number;
}

/**
 * MediaRecorder wrapper. The microphone is requested only when the user
 * presses Record, and the stream is released after every recording so the
 * browser's mic indicator turns off.
 */
export class MicrophoneRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  onChange: (recording: boolean) => void = () => {};

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  get elapsedS(): number {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  private mime(): string | undefined {
    return CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mime = this.mime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = performance.now();
    this.onChange(true);
  }

  stop(): Promise<RecordingResult | null> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') {
      this.release();
      return Promise.resolve(null);
    }
    const durationMs = performance.now() - this.startedAt;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const mime = rec.mimeType || this.mime() || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        this.release();
        this.onChange(false);
        resolve(blob.size ? { blob, mime, durationMs } : null);
      };
      rec.stop();
    });
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}
