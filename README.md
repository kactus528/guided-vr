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

## Research-informed additions

- **Monthly questionnaire (ITQ):** the International Trauma Questionnaire (Cloitre et al., 2018), the most widely used self-report measure of ICD-11 PTSD and complex PTSD. The wording is verbatim, since the authors release it for use without change. Results show symptom totals, cluster scores, the published screening rule and your past results. It's a screen, not a diagnosis.
- **Resource & Stabilization mode:** short (8 s), slow (0.6 cycles/s) sets while focusing on a positive resource, modelled on EMDR Resource Development and Installation (Korn & Leeds, 2002; the evidence is preliminary). Sets continue only while the experience stays positive. If it turns upsetting, the resource is set aside and never processed.
- **Focused processing (default):** based on stabilization-oriented "restricted" EMDR formats. Later sets return to the same narrow starting point instead of following associations. Gentle stopping cues appear when distress is low (≤ 2) or high (≥ 8), and after about six sets. You can switch to *Open* in Settings.
- **Expanded present-moment check-in:** four questions (present, unreal, body, far away/foggy). Any "yes" stops stimulation for the session. These are the app's own prompts, not a validated scale.

- **Standard protocol mode** (Settings → Processing style): the closest this app gets to a clinical EMDR session.
  - *Desensitization:* "Go with that" chains sets on whatever comes up, and "Back to the target" re-checks the original memory's 0–10 rating. When the target reaches 0–1, the session moves on.
  - *Cognitive interweaves:* the prompts therapists use when processing gets stuck.
  - *Installation:* sets that pair the memory with your positive belief until it feels 6–7 on the 1–7 scale.
  - *Body scan:* sets continue on any leftover sensation until the scan comes up clear.
  - *Closure:* explains incomplete sessions.
  - *Session time budget:* 30–120 min, default 60. A prompt to start closing appears with 15 minutes left.
  - *Safeguards:* Ground and the dissociation stop still apply. High distress shows information, not a stop.

What the research argued *against*: personalising eye-movement speed to working-memory capacity didn't help in controlled studies, so calibration stays about comfort. "EMDR 2.0"-style extra taxing showed no added effect.

## AI guide (optional)

During reflection steps you can talk or type to a conversational guide (main menu → **AI Guide**).

- **Providers:**
  - Anthropic (Claude), called directly from the browser with your own key.
  - Any OpenAI-compatible endpoint (OpenAI, OpenRouter, or a local server).
  - Your own proxy (`proxy/worker.js`, a Cloudflare Worker that keeps the key off the headset).
  - Built-in offline prompts, which are also the automatic fallback when the AI is unavailable or fails.
- **Voice:** push-to-talk through browser speech recognition or a Whisper-compatible service, or typing only. Replies are spoken with browser TTS and shown as subtitles.
- **Consent:** nothing is sent until you consent for the chosen provider. Changing provider, voice input or history sharing asks again. Past-session history and confirmed patterns are off by default; when on, only a few related sessions go out, as short text summaries. Raw recordings never leave the device.
- **Control:** the guide can only *request* `repeat_instruction`, `record_reflection`, `show_emotional_rating`, `pause_session`, `begin_grounding` or `finish_session`. A deterministic validator checks each request against the current stage, and anything else is ignored. The guide can't start sets or change stimulation.
- **Safety:** deterministic keyword checks run on what you say *before* anything reaches the AI.
  - Disorientation phrases ground you and lock stimulation for the session.
  - Crisis phrases do the same, skip the AI entirely, and show crisis resources (988 in the US).
  - Replies that diagnose, claim to be a therapist, suggest hidden memories, or pressure you to continue are replaced with a neutral prompt.
  - These are safeguards, not a detector.
- **Patterns:** the guide may offer a tentative pattern ("a guess, not a fact"). It's saved only if you confirm it. You can delete conversation logs, confirmed patterns, and API keys from the AI Guide screen.

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
