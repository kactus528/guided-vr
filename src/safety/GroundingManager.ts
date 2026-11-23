/**
 * The persistent stop control. Runs the same ordered sequence from any
 * state (spec §29). Stimulation is never restarted from here — returning to a
 * session lands on the post-set check-in or the step the user was on.
 */
export interface GroundingHooks {
  stopVisual(): void; // also stops audio + haptics via the stimulation engine
  stopAudio(): void;
  stopHaptics(): void;
  pauseNarrationAndRecording(): Promise<void>;
  showGroundingEnvironment(): void;
  offerOptions(): void;
}

export class GroundingManager {
  active = false;
  uses = 0;

  constructor(private hooks: GroundingHooks) {}

  async engage(): Promise<void> {
    this.active = true;
    this.uses++;
    const h = this.hooks;
    h.stopVisual();
    h.stopAudio();
    h.stopHaptics();
    const saving = h.pauseNarrationAndRecording(); // narration stops synchronously; any recording is saved
    h.showGroundingEnvironment();
    h.offerOptions();
    await saving;
  }

  release(): void {
    this.active = false;
  }
}

export const GROUNDING_TEXT =
  'Stimulation has stopped. Take whatever time you need.\n\n' +
  'Look around and notice a few things you can see. Listen for sounds in your physical room. ' +
  'Feel the weight of your body on the chair or bed, and your feet or hands against something solid.\n\n' +
  'Today is {{date}}. You can take the headset off at any time.';

export const ORIENTATION_NARRATION =
  'Feel the surface underneath you. Press your feet into the floor, or your hands into the chair or bed. ' +
  'Notice the temperature of the air, and one sound in the room around you. Today is {{date}}. ' +
  'You are here, in the room where you started. You can take the headset off at any time.';
