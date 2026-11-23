/**
 * International Trauma Questionnaire (ITQ), 12-item version plus functional
 * impairment items. Cloitre, Shevlin, Brewin, Bisson, Roberts, Maercker,
 * Karatzias & Hyland (2018), Acta Psychiatrica Scandinavica 138(6), 536–546.
 * The authors state it is freely available in the public domain for use
 * without change — item wording below is kept verbatim.
 *
 * It is a self-report screening measure, not a diagnosis.
 */

export const ITQ_SCALE = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'A little bit' },
  { value: 2, label: 'Moderately' },
  { value: 3, label: 'Quite a bit' },
  { value: 4, label: 'Extremely' },
];

export const ITQ_PTSD_INTRO =
  'Below are problems that people sometimes report in response to traumatic or stressful life events. ' +
  'Please read each one carefully and choose how much you have been bothered by that problem in the past month.';

export const ITQ_PTSD_ITEMS: { field: string; cluster: 'Re' | 'Av' | 'Th'; text: string }[] = [
  { field: 'itq_p1', cluster: 'Re', text: 'Having upsetting dreams that replay part of the experience or are clearly related to the experience?' },
  { field: 'itq_p2', cluster: 'Re', text: 'Having powerful images or memories that sometimes come into your mind in which you feel the experience is happening again in the here and now?' },
  { field: 'itq_p3', cluster: 'Av', text: 'Avoiding internal reminders of the experience (for example, thoughts, feelings, or physical sensations)?' },
  { field: 'itq_p4', cluster: 'Av', text: 'Avoiding external reminders of the experience (for example, people, places, conversations, objects, activities, or situations)?' },
  { field: 'itq_p5', cluster: 'Th', text: 'Being "super-alert", watchful, or on guard?' },
  { field: 'itq_p6', cluster: 'Th', text: 'Feeling jumpy or easily startled?' },
];

export const ITQ_PTSD_FI_INTRO = 'In the past month have the above problems:';
export const ITQ_PTSD_FI = [
  { field: 'itq_pfi1', text: 'Affected your relationships or social life?' },
  { field: 'itq_pfi2', text: 'Affected your work or ability to work?' },
  { field: 'itq_pfi3', text: 'Affected any other important part of your life such as parenting, or school or college work, or other important activities?' },
];

export const ITQ_DSO_INTRO =
  'Below are problems that people who have had stressful or traumatic events sometimes experience. ' +
  'The questions refer to ways you typically feel, ways you typically think about yourself and ways you typically relate to others. ' +
  'Answer the following thinking about how true each statement is of you.';

export const ITQ_DSO_ITEMS: { field: string; cluster: 'AD' | 'NSC' | 'DR'; text: string }[] = [
  { field: 'itq_c1', cluster: 'AD', text: 'When I am upset, it takes me a long time to calm down.' },
  { field: 'itq_c2', cluster: 'AD', text: 'I feel numb or emotionally shut down.' },
  { field: 'itq_c3', cluster: 'NSC', text: 'I feel like a failure.' },
  { field: 'itq_c4', cluster: 'NSC', text: 'I feel worthless.' },
  { field: 'itq_c5', cluster: 'DR', text: 'I feel distant or cut off from people.' },
  { field: 'itq_c6', cluster: 'DR', text: 'I find it hard to stay emotionally close to people.' },
];

export const ITQ_DSO_FI_INTRO = 'In the past month, have the above problems in emotions, in beliefs about yourself and in relationships:';
export const ITQ_DSO_FI = [
  { field: 'itq_cfi1', text: 'Created concern or distress about your relationships or social life?' },
  { field: 'itq_cfi2', text: 'Affected your work or ability to work?' },
  { field: 'itq_cfi3', text: 'Affected any other important parts of your life such as parenting, or school or college work, or other important activities?' },
];

export interface ItqResult {
  complete: boolean;
  ptsdTotal: number; // 0–24
  dsoTotal: number; // 0–24
  clusters: Record<'Re' | 'Av' | 'Th' | 'AD' | 'NSC' | 'DR', number>;
  /** Screening category from the published algorithm (item endorsed at ≥ 2 "Moderately"). */
  screen: 'none' | 'PTSD' | 'CPTSD' | 'incomplete';
}

const ENDORSED = 2;

/** Scores answers keyed by the fields above. Missing items → 'incomplete' screen (totals still summed). */
export function scoreItq(a: Record<string, unknown>): ItqResult {
  const n = (f: string): number | null => (typeof a[f] === 'number' ? (a[f] as number) : null);
  const all = [...ITQ_PTSD_ITEMS, ...ITQ_DSO_ITEMS, ...ITQ_PTSD_FI, ...ITQ_DSO_FI];
  const complete = all.every((i) => n(i.field) !== null);
  const clusters = { Re: 0, Av: 0, Th: 0, AD: 0, NSC: 0, DR: 0 };
  let ptsdTotal = 0;
  let dsoTotal = 0;
  for (const i of ITQ_PTSD_ITEMS) {
    const v = n(i.field) ?? 0;
    ptsdTotal += v;
    clusters[i.cluster] += v;
  }
  for (const i of ITQ_DSO_ITEMS) {
    const v = n(i.field) ?? 0;
    dsoTotal += v;
    clusters[i.cluster] += v;
  }
  if (!complete) return { complete, ptsdTotal, dsoTotal, clusters, screen: 'incomplete' };

  const any = (items: { field: string }[]) => items.some((i) => (n(i.field) ?? 0) >= ENDORSED);
  const clusterMet = (items: { field: string; cluster: string }[], c: string) => any(items.filter((i) => i.cluster === c));
  const ptsdSymptoms = ['Re', 'Av', 'Th'].every((c) => clusterMet(ITQ_PTSD_ITEMS, c));
  const dsoSymptoms = ['AD', 'NSC', 'DR'].every((c) => clusterMet(ITQ_DSO_ITEMS, c));
  const ptsd = ptsdSymptoms && any(ITQ_PTSD_FI);
  const dso = dsoSymptoms && any(ITQ_DSO_FI);
  // A person meets PTSD or CPTSD, never both.
  const screen = ptsd && dso ? 'CPTSD' : ptsd ? 'PTSD' : 'none';
  return { complete, ptsdTotal, dsoTotal, clusters, screen };
}
