/** Encode mono float PCM as a 16-bit WAV blob (playable by <audio>, storable in IndexedDB). */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Split text into speakable sentences so the first one can play while the rest are generated. */
export function splitSentences(text: string, max = 220): string[] {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["”']?|[^.!?…]+$/g) ?? [];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= max) { out.push(p); continue; }
    let rest = p;
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(',', max - 1), rest.lastIndexOf(' ', max - 1));
      out.push(rest.slice(0, cut > 40 ? cut + 1 : max).trim());
      rest = rest.slice(cut > 40 ? cut + 1 : max);
    }
    if (rest.trim()) out.push(rest.trim());
  }
  return out;
}

export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
