# Guided VR Emotional Reprocessing — Milestone 1

A private, experimental WebXR app for the Meta Quest 2 browser (with a desktop preview).
It is **not** a clinically validated EMDR treatment, and it doesn't diagnose or treat PTSD/CPTSD.

## Run it

**Option A: the live build.** https://kactus528.github.io/guided-vr/ — open it in the Quest browser and press **Enter VR**.
`docs/` is the prebuilt static site GitHub Pages serves (Settings → Pages → `main` / `/docs`). Three.js 0.170 is hosted alongside it (no CDN).
After changing source, run `npm run build:docs` to refresh it.

In the browser you get a full 2D interface (like the Ganzflicker app): run sessions on the page, type answers directly, and press **Enter VR** whenever you like. Inside VR the same screens appear as floating panels. Allow the microphone from the main menu *before* entering VR — the Quest can only show that prompt outside VR.
After the first online load, the service worker caches the app (including Three.js) so it works offline.

**Option B: build from source** (bundles Three.js locally, no CDN):

```bash
npm install
npm run dev        # HTTPS dev server on your LAN; open https://<your-pc-ip>:5173 on the Quest
npm run build      # type-check + production build into dist/
npm test           # session-engine + timing tests
```

The dev server uses a self-signed certificate, so the Quest browser will ask you to accept it once.

## Controls

| Action | Desktop | Quest |
|---|---|---|
| Select | Click | Trigger |
| Look around | Drag | Head |
| **Ground (stop everything)** | G or Esc, or the HUD button | **B / Y**, or the Ground button |
| Recenter | R | Thumbstick press, or the Recenter button |
| Pause / resume | Space | Pause button |

Use **Settings → Position → Reclining** before recentering if you're lying down. Recentering then takes the full head orientation, not just yaw.

## What Milestone 1 includes

- **The full guided flow** (`src/session/definitions.ts`): welcome → safety notes → arriving/grounding (with an optional 10 s neutral practice set) → five entry points → description, feelings, negative and preferred beliefs, body → baseline distress (0–10) and belief-validity (1–7) ratings → **opt-in** activation (skippable, with a gentle note if distress is already high) → bilateral set → dual-awareness check-in → reflection (voice, text, optional rating) → another set or closing → preferred-belief revisit → body awareness → guided closure → summary.
- **Dual-awareness safeguard**: if the check-in reports "not present" or "yes, unreal/detached", the flow goes to orientation and **locks stimulation for the rest of the session**. Engine tests cover this.
- **Stimulation never starts on its own.** Every set starts from a button press, sets end automatically, and the second and later sets don't re-prompt activation.
- **Ground** works from every state and stops visual, audio and haptics, narration and recording. It then shows a static grounding scene with orientation, closing, exit-VR and end options. Returning goes to a check-in, never back into stimulation.
- **Visual stimulation**: one clock drives everything, so animation is frame-rate independent. The target is placed on a sphere around the head so distance and angular size stay constant. Configurable speed, width, distance, size, brightness, colour, set length and pattern (sinusoidal, horizontal, or arc, which is marked experimental). Sets end with the target back at centre.
- **Bilateral audio**: Web Audio beats routed explicitly into the left or right input of a `ChannelMergerNode`, and scheduled on the audio clock from the same beat times as the visuals. Soft tone, click or pulse. These are alternating sounds, not binaural beats.
- **Haptics**: optional alternating controller pulses, with feature detection and graceful fallback.
- **Narration**: browser text-to-speech with subtitles. It looks for recorded Voice Studio clips first (stored per profile in IndexedDB), ready for Milestone 2. Pause, resume, repeat. There's no narration during sets.
- **Voice responses**: record, stop, replay, re-record, delete. The mic is requested only when you press Record and released afterwards. Recording indicators show in VR and on desktop. Each clip is stored with its session ID, step, prompt, time and a snapshot of your ratings.
- **Journal**: every step autosaves (so an interrupted session is kept). You can view details and play back recordings, delete a single session, delete everything, or export everything as JSON with recordings embedded.
- **Follow-ups**: optional 24-hour and 7-day check-ins (distress, sleep, intrusive memories, triggers, aftereffects, functioning). They appear on the menu the next time you open the app, since there are no background notifications.
- **Neutral Bilateral Lab**: for finding comfortable settings. It reports beats delivered and frame timing.
- **Offline**: service worker plus PWA manifest.

Each stimulation set is logged with its settings snapshot, planned and actual duration, beats delivered per modality, average and worst frame time, and why it ended.

## Verified vs. not verified

- ✅ Type-checked (strict). Unit tests for the session engine, routing, stimulation lock and beat timing.
- ✅ End-to-end smoke test in headless Chromium (with Three.js stubbed and a fake microphone). It ran a full session: practice set, recording, grounding mid-set, pause/resume, a detachment report leading to orientation and the lock, summary, journal and follow-up scheduling, with no runtime errors. It measured a 10 s set at 20 beats with 20 audio beats delivered.
- ❌ **Not yet tested on a Quest 2**: real 72 fps performance, controller input, haptics, mic recording inside VR, speech synthesis on the Quest browser, and how recentering behaves when reclining. Those are Milestone 6 items, and I won't claim Quest compatibility until they're checked on the headset.

## Architecture

```
src/
  app/App.ts                    orchestrator: screens, step rendering, effects
  session/types.ts              session-definition + record types
  session/definitions.ts        Guided Session + Follow-up flows (pure data)
  session/SessionEngine.ts      state machine (no DOM; unit-tested)
  stim/BilateralStimulationEngine.ts  central timing: visual + audio + haptic
  stim/VisualStimulusController.ts    luminous target
  stim/AudioStimulusController.ts     stereo-routed beats
  stim/HapticStimulusController.ts    controller pulses
  stim/patterns.ts              movement patterns + beat timing (unit-tested)
  audio/NarrationManager.ts     recorded clip → TTS → subtitles fallback
  audio/MicrophoneRecorder.ts   MediaRecorder wrapper
  safety/GroundingManager.ts    the ordered stop sequence
  data/db.ts, JournalManager.ts IndexedDB storage, export, follow-ups
  xr/XRExperienceManager.ts     renderer, WebXR session, controllers, recenter, desktop preview
  env/EnvironmentManager.ts     Void + grounding scene
  ui/Panel.ts                   canvas-texture UI (mouse + controller rays)
  settings/SettingsManager.ts
```

To add a new flow, write a `SessionDefinition`: steps, inputs, actions, routes, conditions and effects. You don't need to touch UI code. The remaining modules from the spec (Voice Studio, pattern map, calibration lab, flicker lab, dashboard) plug in as new screens and definitions. The IndexedDB `narration` store is already in place for Voice Studio.

## Privacy

Everything stays in this browser's IndexedDB on this device. Nothing is uploaded. IndexedDB is **not encrypted** and can be cleared by the browser, so export if you want a copy.
