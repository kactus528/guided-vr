import type { ConfirmedPattern } from '../ai/types.js';
import type { FollowUpDue, SessionRecord } from '../session/types.js';
import { clear, del, get, getAll, getAllBy, put } from './db.js';

export interface RecordingRecord {
  id: string;
  sessionId: string;
  stepId: string;
  field: string;
  prompt: string;
  createdAt: string;
  mime: string;
  durationMs: number;
  blob: Blob;
  ratingsSnapshot: Record<string, number>;
}

const HOUR = 3600_000;

export class JournalManager {
  async save(rec: SessionRecord): Promise<void> {
    await put('sessions', rec);
  }

  async get(id: string): Promise<SessionRecord | undefined> {
    return get<SessionRecord>('sessions', id);
  }

  async list(): Promise<SessionRecord[]> {
    const all = await getAll<SessionRecord>('sessions');
    return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async saveRecording(r: RecordingRecord): Promise<void> {
    await put('recordings', r);
  }

  async recordingsFor(sessionId: string): Promise<RecordingRecord[]> {
    const r = await getAllBy<RecordingRecord>('recordings', 'sessionId', sessionId);
    return r.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async deleteRecording(id: string): Promise<void> {
    await del('recordings', id);
  }

  async deleteSession(id: string): Promise<void> {
    for (const r of await this.recordingsFor(id)) await del('recordings', r.id);
    await del('sessions', id);
  }

  async deleteAll(): Promise<void> {
    await clear('recordings');
    await clear('sessions');
    await clear('patterns');
  }

  async patterns(): Promise<ConfirmedPattern[]> {
    return (await getAll<ConfirmedPattern>('patterns')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async savePattern(p: ConfirmedPattern): Promise<void> {
    await put('patterns', p);
  }

  async deletePatterns(): Promise<void> {
    await clear('patterns');
  }

  /** Removes stored AI conversation turns from every session (recordings and answers are kept). */
  async deleteAIConversations(): Promise<number> {
    let n = 0;
    for (const s of await this.list()) {
      if (s.ai?.length) {
        delete s.ai;
        await put('sessions', s);
        n++;
      }
    }
    return n;
  }

  static followUpsFor(endedAt: number): FollowUpDue[] {
    return [
      { kind: '24h', due: endedAt + 24 * HOUR, done: false },
      { kind: '7d', due: endedAt + 7 * 24 * HOUR, done: false },
    ];
  }

  /** The most pressing due follow-up, if any (shown on next open; no background notifications). */
  async pendingFollowUp(): Promise<{ session: SessionRecord; fu: FollowUpDue } | null> {
    const now = Date.now();
    for (const s of await this.list()) {
      const fu = s.followUps?.find((f) => !f.done && f.due <= now);
      if (fu) return { session: s, fu };
    }
    return null;
  }

  /** Full export as one JSON file; recordings embedded as base64 data URLs. */
  async exportAll(): Promise<Blob> {
    const sessions = await this.list();
    const recordings = await getAll<RecordingRecord>('recordings');
    const recs = await Promise.all(
      recordings.map(async (r) => ({ ...r, blob: undefined, dataUrl: await blobToDataUrl(r.blob) })),
    );
    const out = {
      app: 'guided-vr-reprocessing',
      exportedAt: new Date().toISOString(),
      note: 'Personal observational data. Not clinical data and not evidence of treatment efficacy.',
      sessions,
      patterns: await getAll('patterns'),
      recordings: recs,
    };
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(b);
  });
}
