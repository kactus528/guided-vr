import type { SessionDefinition } from './types.js';

const NEG_BELIEFS = [
  "I'm not good enough",
  "I'm not safe",
  "I'm alone",
  "It's my fault",
  "I don't matter",
  "I can't trust myself",
  "I'm too much",
  "I'm powerless",
];

const POS_BELIEFS = [
  'I am enough',
  "I'm safe now",
  'I can connect with others',
  'I did the best I could',
  'I matter',
  'I can trust myself',
  'I can take up space',
  'I have choices now',
];

const EMOTIONS = [
  'Sadness', 'Fear', 'Shame', 'Anger', 'Loneliness', 'Anxiety',
  'Guilt', 'Grief', 'Hurt', 'Overwhelm', 'Numbness', 'Other',
];

const SENSATIONS = [
  'Chest', 'Throat', 'Stomach', 'Shoulders', 'Jaw', 'Head', 'Hands',
  'Whole body', 'Tightness', 'Heaviness', 'Restlessness', 'Numbness', 'Nothing in particular',
];

/**
 * The primary guided flow. Text is deliberately non-directive: it never
 * suggests hidden memories, never asks the user to intensify material, and
 * never ties continuation to ratings.
 */
export const GUIDED_SESSION: SessionDefinition = {
  id: 'guided-v1',
  version: 1,
  title: 'Guided Session',
  start: 'welcome',
  stimLockedFallback: 'closure',
  steps: [
    // 1. Welcome and orientation
    {
      id: 'welcome',
      stage: 'welcome',
      type: 'form',
      environment: 'grounding',
      title: 'Welcome',
      body:
        "This is a private, experimental space for gently exploring an emotion, belief, sensation, or memory alongside bilateral stimulation.\n\n" +
        "It isn't therapy, and it isn't a validated EMDR treatment. You're in control throughout: you can pause, ground, or end at any moment with the buttons along the bottom, the B or Y button on a controller, or the G key.",
      narration: {
        segment: 'welcome',
        text: "Welcome. This is a private, experimental space. You're in control the whole time, and you can pause, ground, or end whenever you like.",
      },
      actions: [
        { id: 'continue', label: 'Continue', goto: 'safety', style: 'primary' },
        { id: 'menu', label: 'Back to menu', effects: ['menu'] },
      ],
    },
    {
      id: 'safety',
      stage: 'preparation',
      type: 'form',
      environment: 'grounding',
      title: 'Before you begin',
      body:
        "• Distress can rise during this kind of work. That's a signal to slow down, not to push through.\n" +
        "• If you're in crisis right now, or you tend to lose track of where you are when upset, this is best used alongside a trained therapist.\n" +
        "• If you feel detached, unreal, or overwhelmed, choose Ground. Stimulation stops immediately and won't restart on its own.",
      actions: [{ id: 'ok', label: 'I understand', goto: 'arriving', style: 'primary' }],
    },
    // 2. Preparation and grounding
    {
      id: 'arriving',
      stage: 'preparation',
      type: 'form',
      environment: 'grounding',
      title: 'Arriving',
      body:
        'Take a moment to settle. Feel where your body is supported. Let your breath be however it is. Notice one or two sounds in the room around you.\n\n' +
        'You can recenter the view, try a short neutral practice set to check the speed and comfort, or adjust the settings.',
      narration: {
        segment: 'arriving',
        text: 'Take a moment to settle. Feel where your body is supported. Let your breath be however it is. Notice one or two sounds in the room around you.',
      },
      actions: [
        { id: 'continue', label: 'Continue', goto: 'entry', style: 'primary' },
        { id: 'practice', label: 'Neutral practice set (10 s)', goto: 'practice' },
        { id: 'settings', label: 'Adjust stimulation', effects: ['settings'] },
        { id: 'recenter', label: 'Recenter view', effects: ['recenter'] },
      ],
    },
    {
      id: 'practice',
      stage: 'preparation',
      type: 'stimulation',
      environment: 'void',
      title: 'Practice set',
      stim: { countsAsSet: false, duration: 10 },
      next: 'arriving',
    },
    // 3. Emotional target identification
    {
      id: 'entry',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'Where would you like to begin?',
      body: "Choose whatever feels most available. You don't need to know where a feeling comes from.",
      inputs: [
        {
          kind: 'choice',
          field: 'entryPoint',
          autoAdvance: true,
          options: [
            { value: 'memory', label: 'A specific remembered experience' },
            { value: 'trigger', label: 'A present-day trigger' },
            { value: 'belief', label: 'A persistent negative belief about myself' },
            { value: 'pattern', label: 'A recurring emotional pattern' },
            { value: 'reaction', label: "A reaction I can't explain" },
          ],
        },
      ],
      next: 'describe',
    },
    {
      id: 'describe',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'In a few words',
      bodyByAnswer: {
        field: 'entryPoint',
        map: {
          memory: "If you'd like, give the experience you already remember a short label. There's no need to describe details.",
          trigger: 'What is the situation that tends to set this off?',
          belief: 'When does this belief tend to show up?',
          pattern: 'What usually happens when this pattern shows up?',
          reaction: "What happens, and when do you notice it? It's completely fine not to know why.",
          '*': 'Describe what you would like to work with, as briefly as you like.',
        },
      },
      inputs: [
        { kind: 'voice', field: 'situation_voice', label: 'Speak' },
        { kind: 'text', field: 'situation_text', label: 'Or type (desktop)', placeholder: 'A few words…' },
      ],
      actions: [
        { id: 'continue', label: 'Continue', goto: 'emotion', style: 'primary' },
        { id: 'skip', label: 'Skip', goto: 'emotion' },
      ],
    },
    {
      id: 'emotion',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'What feelings are here?',
      body: 'Choose any that fit, or skip.',
      inputs: [
        { kind: 'chips', field: 'emotions', items: EMOTIONS, multi: true },
        { kind: 'text', field: 'emotions_text', label: 'Other words (desktop)', placeholder: 'Optional' },
      ],
      actions: [
        { id: 'continue', label: 'Continue', goto: 'negative', style: 'primary' },
        { id: 'skip', label: 'Skip', goto: 'negative' },
      ],
    },
    {
      id: 'negative',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'A belief that comes with it',
      body: 'Is there a thought about yourself that goes with this? Pick one, say it in your own words, or skip.',
      inputs: [
        { kind: 'chips', field: 'negBelief', items: NEG_BELIEFS, multi: false },
        { kind: 'voice', field: 'negBelief_voice', label: 'Say it' },
        { kind: 'text', field: 'negBelief_text', label: 'Or type (desktop)' },
      ],
      actions: [
        { id: 'continue', label: 'Continue', goto: 'positive_pick', style: 'primary' },
        { id: 'skip', label: 'Skip', goto: 'positive_pick' },
      ],
    },
    {
      id: 'positive_pick',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'What would you prefer to believe?',
      body: "This doesn't need to feel true yet.",
      inputs: [
        { kind: 'chips', field: 'posBelief', items: POS_BELIEFS, multi: false },
        { kind: 'voice', field: 'posBelief_voice', label: 'Say it' },
        { kind: 'text', field: 'posBelief_text', label: 'Or type (desktop)' },
      ],
      actions: [
        { id: 'continue', label: 'Continue', goto: 'sensations', style: 'primary' },
        { id: 'skip', label: 'Skip', goto: 'sensations' },
      ],
    },
    {
      id: 'sensations',
      stage: 'target',
      type: 'form',
      environment: 'void',
      title: 'Where do you notice it in your body?',
      body: 'Choose any that fit, or skip.',
      inputs: [{ kind: 'chips', field: 'sensations', items: SENSATIONS, multi: true }],
      actions: [
        { id: 'continue', label: 'Continue', goto: 'baseline', style: 'primary' },
        { id: 'skip', label: 'Skip', goto: 'baseline' },
      ],
    },
    // 4. Baseline assessment
    {
      id: 'baseline',
      stage: 'baseline',
      type: 'form',
      environment: 'void',
      title: 'Where things are right now',
      body: 'Both ratings are optional.',
      inputs: [
        { kind: 'rating', field: 'sud_0', label: 'How distressing does this feel right now?', min: 0, max: 10, minLabel: 'None', maxLabel: 'Most imaginable' },
        {
          kind: 'rating', field: 'voc_0', label: 'How true does "{{posBelief|posBelief_text}}" feel right now?',
          min: 1, max: 7, minLabel: 'Not at all', maxLabel: 'Completely',
          when: { anyPresent: ['posBelief', 'posBelief_text'] },
        },
      ],
      actions: [{ id: 'continue', label: 'Continue', goto: 'activation_offer', style: 'primary' }],
    },
    // 5. Optional voluntary activation
    {
      id: 'activation_offer',
      stage: 'activation',
      type: 'form',
      environment: 'void',
      title: 'Optional: bringing it to mind',
      body:
        'If you choose, you can bring the experience, situation, or feeling you named into awareness — only as much as feels manageable. Distress may increase.\n\n' +
        'You can also skip this and simply work with whatever is present now.',
      notes: [
        {
          when: { field: 'sud_0', gte: 8 },
          tone: 'warn',
          text: 'Your distress is already high. You might prefer to skip this step and work with what is present, or to ground first.',
        },
      ],
      actions: [
        { id: 'activate', label: 'Bring it to mind', goto: 'activation' },
        { id: 'skip', label: "Skip — stay with what's present", goto: 'set_ready', style: 'primary' },
      ],
    },
    {
      id: 'activation',
      stage: 'activation',
      type: 'form',
      environment: 'void',
      title: 'Bringing it to mind',
      body:
        "Let what you chose come to mind, only as much as feels manageable. You don't need to hold onto it or make it stronger.\n\nWhen you're ready, begin the set.",
      narration: {
        segment: 'activation',
        text: "Let what you chose come to mind, only as much as feels manageable. You don't need to hold onto it, or make it stronger. When you're ready, begin the set.",
      },
      actions: [
        { id: 'begin', label: 'Begin set', goto: 'stim', style: 'primary' },
        { id: 'notnow', label: 'Not now', goto: 'set_ready' },
      ],
    },
    {
      id: 'set_ready',
      stage: 'stimulation',
      type: 'form',
      environment: 'void',
      title: 'Ready for a set',
      body: 'Follow the light with your eyes. Let whatever happens, happen — or nothing at all. The set ends on its own, and you can stop it at any time.',
      actions: [
        { id: 'begin', label: 'Begin set', goto: 'stim', style: 'primary' },
        { id: 'settings', label: 'Adjust stimulation', effects: ['settings'] },
        { id: 'close', label: 'Move to closing', goto: 'positive_end' },
      ],
    },
    // 6. Bilateral stimulation
    {
      id: 'stim',
      stage: 'stimulation',
      type: 'stimulation',
      environment: 'void',
      title: 'Set in progress',
      stim: { countsAsSet: true },
      next: 'checkin',
    },
    // Dual-awareness check
    {
      id: 'checkin',
      stage: 'checkin',
      type: 'form',
      environment: 'void',
      title: 'Checking in',
      body: 'Take a breath. Notice the room you are in.',
      inputs: [
        {
          kind: 'choice', field: 'present_{set}', label: 'Do you feel present in your surroundings?', options: [
            { value: 'yes', label: 'Yes' },
            { value: 'partly', label: 'Partly' },
            { value: 'no', label: 'Not really' },
          ],
        },
        {
          kind: 'choice', field: 'unreal_{set}', label: 'Does anything feel unreal, distant, or detached?', options: [
            { value: 'no', label: 'No' },
            { value: 'little', label: 'A little' },
            { value: 'yes', label: 'Yes' },
          ],
        },
      ],
      actions: [
        {
          id: 'continue', label: 'Continue', style: 'primary', goto: 'reflection',
          route: [
            { when: { field: 'present_{set}', in: ['no'] }, goto: 'orientation', effects: ['lockStim'] },
            { when: { field: 'unreal_{set}', in: ['yes'] }, goto: 'orientation', effects: ['lockStim'] },
          ],
        },
        { id: 'ground', label: 'I want to pause and ground', goto: 'orientation', effects: ['lockStim'] },
      ],
    },
    {
      id: 'orientation',
      stage: 'grounding',
      type: 'form',
      environment: 'grounding',
      onEnter: ['lockStim'],
      title: 'Coming back to the room',
      body:
        "Stimulation is off for the rest of this session and won't restart.\n\n" +
        'Feel the surface underneath you. Press your feet into the floor, or your hands into the chair or bed. Notice the temperature of the air. Today is {{date}}. You are in the room where you started.\n\n' +
        'You can take the headset off at any point and look around your physical room.',
      narration: {
        segment: 'orientation',
        text: "Let's stop here. Stimulation is off, and won't restart. Feel the surface underneath you. Press your feet into the floor, or your hands into the chair or bed. Notice the temperature of the air. Today is {{date}}. You are in the room where you started. You can take the headset off at any time.",
      },
      actions: [
        { id: 'closing', label: 'Continue to closing', goto: 'body_end', style: 'primary' },
        { id: 'exitvr', label: 'Take off headset (exit VR)', effects: ['exitXR'] },
        { id: 'end', label: 'End session now', effects: ['endNow'] },
      ],
    },
    // 7. Reflection
    {
      id: 'reflection',
      stage: 'reflection',
      type: 'form',
      environment: 'void',
      title: 'What are you noticing now?',
      body: 'Anything is fine — a thought, a feeling, a sensation, an image, or nothing at all.',
      narration: { segment: 'reflection', text: 'What are you noticing now?' },
      notes: [
        { when: { field: 'present_{set}', in: ['partly'] }, text: 'If the sense of distance grows, choose Ground at any time.' },
        { when: { field: 'unreal_{set}', in: ['little'] }, text: 'If the sense of distance grows, choose Ground at any time.' },
        { when: { setCountGte: 8 }, text: "You've done several sets. It's completely fine to close here." },
      ],
      inputs: [
        { kind: 'voice', field: 'reflect_{set}_voice', label: 'Speak' },
        { kind: 'text', field: 'reflect_{set}_text', label: 'Or type (desktop)' },
        { kind: 'rating', field: 'sud_{set}', label: 'Distress right now (optional)', min: 0, max: 10, minLabel: 'None', maxLabel: 'Most imaginable' },
      ],
      actions: [
        { id: 'again', label: 'Another set', goto: 'set_again' },
        { id: 'close', label: 'Move toward closing', goto: 'positive_end', style: 'primary' },
      ],
    },
    // 8. Optional additional sets — no re-activation
    {
      id: 'set_again',
      stage: 'stimulation',
      type: 'form',
      environment: 'void',
      title: 'Another set',
      body: "Notice whatever is here now. There's no need to go back to the original memory or make anything stronger.",
      actions: [
        { id: 'begin', label: 'Begin set', goto: 'stim', style: 'primary' },
        { id: 'settings', label: 'Adjust stimulation', effects: ['settings'] },
        { id: 'close', label: 'Move to closing', goto: 'positive_end' },
      ],
    },
    // 9. Positive-belief integration
    {
      id: 'positive_end',
      stage: 'integration',
      type: 'form',
      environment: 'void',
      when: { anyPresent: ['posBelief', 'posBelief_text'] },
      next: 'body_end',
      title: 'Revisiting the preferred belief',
      body: 'Earlier you named: "{{posBelief|posBelief_text}}".\n\nHold it lightly alongside whatever is here now. There\'s no right answer and no need for it to have changed.',
      inputs: [
        { kind: 'rating', field: 'voc_end', label: 'How true does it feel at the moment?', min: 1, max: 7, minLabel: 'Not at all', maxLabel: 'Completely' },
      ],
      actions: [{ id: 'continue', label: 'Continue', goto: 'body_end', style: 'primary' }],
    },
    // 10. Body awareness
    {
      id: 'body_end',
      stage: 'body',
      type: 'form',
      environment: 'grounding',
      title: 'Noticing the body',
      body: "Gently notice your body. If something unpleasant is there, you don't need to do anything with it.",
      narration: {
        segment: 'body',
        text: "Gently notice your body. If something unpleasant is there, you don't need to do anything with it.",
      },
      inputs: [
        { kind: 'chips', field: 'sensations_end', items: ['Tension', 'Comfort', 'Discomfort', 'Calm', 'Heaviness', 'Lightness', 'Restlessness', 'Numbness', 'Nothing in particular'], multi: true },
        { kind: 'voice', field: 'body_voice', label: 'Speak (optional)' },
      ],
      actions: [{ id: 'continue', label: 'Continue', goto: 'closure', style: 'primary' }],
    },
    // 11. Guided closure
    {
      id: 'closure',
      stage: 'closure',
      type: 'form',
      environment: 'grounding',
      title: 'Closing',
      body:
        'Whatever is unfinished can be set aside for now. You might imagine placing it in a container you can come back to later, or bring to a therapist.\n\n' +
        'Take a slower breath. Feel the support beneath you. Notice the room you are in.',
      narration: {
        segment: 'closure',
        text: "We're coming to the end. Whatever is unfinished can be set aside for now. You might imagine placing it in a container you can come back to later. Take a slower breath. Feel the support beneath you, and notice the room you're in.",
      },
      inputs: [
        { kind: 'rating', field: 'sud_end', label: 'Distress right now (optional)', min: 0, max: 10, minLabel: 'None', maxLabel: 'Most imaginable' },
      ],
      actions: [{ id: 'continue', label: 'Continue', goto: 'summary', style: 'primary' }],
    },
    // 12 + 13. Summary and follow-up scheduling
    {
      id: 'summary',
      stage: 'summary',
      type: 'summary',
      environment: 'grounding',
      title: 'Session summary',
      actions: [{ id: 'finish', label: 'Finish', effects: ['complete'], style: 'primary' }],
    },
  ],
};

export const FOLLOW_UP: SessionDefinition = {
  id: 'followup-v1',
  version: 1,
  title: 'Follow-up check-in',
  start: 'fu_intro',
  stimLockedFallback: 'fu_done',
  steps: [
    {
      id: 'fu_intro',
      stage: 'followup',
      type: 'form',
      environment: 'grounding',
      title: 'Follow-up check-in',
      body: 'A short check-in about how things have been since your session on {{parentDate}}. Skip anything you like.',
      actions: [
        { id: 'continue', label: 'Continue', goto: 'fu_ratings', style: 'primary' },
        { id: 'menu', label: 'Not now', effects: ['menu'] },
      ],
    },
    {
      id: 'fu_ratings',
      stage: 'followup',
      type: 'form',
      environment: 'grounding',
      title: 'Since the session',
      inputs: [
        { kind: 'rating', field: 'fu_sud', label: 'Distress about the same topic, right now', min: 0, max: 10, minLabel: 'None', maxLabel: 'Most imaginable' },
        { kind: 'choice', field: 'fu_sleep', label: 'Sleep disruption', options: [{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'significant', label: 'Significant' }] },
        { kind: 'choice', field: 'fu_intrusive', label: 'Intrusive memories', options: [{ value: 'fewer', label: 'Fewer' }, { value: 'same', label: 'Same' }, { value: 'more', label: 'More' }, { value: 'na', label: 'N/A' }] },
        { kind: 'choice', field: 'fu_triggers', label: 'Reactions to familiar triggers', options: [{ value: 'milder', label: 'Milder' }, { value: 'same', label: 'Same' }, { value: 'stronger', label: 'Stronger' }, { value: 'na', label: 'Not encountered' }] },
      ],
      actions: [{ id: 'continue', label: 'Continue', goto: 'fu_effects', style: 'primary' }],
    },
    {
      id: 'fu_effects',
      stage: 'followup',
      type: 'form',
      environment: 'grounding',
      title: 'Anything else?',
      inputs: [
        { kind: 'chips', field: 'fu_aftereffects', label: 'Aftereffects', multi: true, items: ['None', 'Headache', 'Eye strain', 'Low mood', 'Irritability', 'Vivid dreams', 'Feeling raw', 'Feeling lighter', 'Other'] },
        { kind: 'choice', field: 'fu_functioning', label: 'Day-to-day functioning', options: [{ value: 'better', label: 'Better' }, { value: 'same', label: 'Same' }, { value: 'worse', label: 'Worse' }] },
        { kind: 'voice', field: 'fu_voice', label: 'Notes (optional)' },
        { kind: 'text', field: 'fu_text', label: 'Or type (desktop)' },
      ],
      actions: [{ id: 'continue', label: 'Save check-in', goto: 'fu_done', style: 'primary' }],
    },
    {
      id: 'fu_done',
      stage: 'followup',
      type: 'form',
      environment: 'grounding',
      title: 'Saved',
      body: 'Thanks — this is stored only on this device.',
      notes: [
        { when: { field: 'fu_functioning', in: ['worse'] }, tone: 'warn', text: 'If things have felt worse since the session, that is useful information. Consider pausing guided sessions and talking it through with a therapist.' },
        { when: { field: 'fu_intrusive', in: ['more'] }, tone: 'warn', text: 'If things have felt worse since the session, that is useful information. Consider pausing guided sessions and talking it through with a therapist.' },
      ],
      actions: [{ id: 'finish', label: 'Finish', effects: ['complete'], style: 'primary' }],
    },
  ],
};

export const DEFINITIONS: Record<string, SessionDefinition> = {
  [GUIDED_SESSION.id]: GUIDED_SESSION,
  [FOLLOW_UP.id]: FOLLOW_UP,
};
