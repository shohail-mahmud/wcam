# wcam

You are an expert front-end engineer. Build a single-page website that uses an in-browser neural hand-tracking model to detect my hand gestures from the webcam and, depending on the gesture, shows one of my attached images as an on-screen overlay.

IMPORTANT
- I will attach multiple images to this request. Use them as project assets.
- Assume I will save them in a folder named /assets next to index.html.
- In your code, reference the images by filename (use the exact filenames I provide/attach).
- Do NOT use any backend. Everything must run locally in the browser.

CORE FEATURES
1) Webcam + real-time hand tracking
- Use getUserMedia for camera input.
- Use MediaPipe Tasks Vision “HandLandmarker” in the browser (WASM) via CDN import.
- Run in VIDEO mode, 1 hand (numHands=1).
- Draw a debug overlay (hand landmarks + connectors) on a canvas on top of the video when debug is enabled.

2) Gesture recognition (rule-based, stable, no flicker)
Detect these gestures reliably using the 21 hand landmarks:
- OPEN_PALM (all 5 fingers extended)  -> show image A
- FIST (all fingers curled)           -> show image B
- POINT (index extended, others curled)-> show image C (example: pointing emoji)
- PEACE (index+middle extended)       -> show image D
- THUMBS_UP (thumb extended up-ish, other fingers curled) -> show image E
- OK_SIGN (thumb tip close to index tip; other fingers extended or semi) -> show image F
- PINCH (thumb tip close to index tip) -> optional: also control zoom of an element smoothly

Gesture detection details (implement exactly):
- Use landmark indices:
  wrist=0
  thumb: 1,2,3,4 (tip=4)
  index: 5,6,7,8 (tip=8)
  middle: 9,10,11,12 (tip=12)
  ring: 13,14,15,16 (tip=16)
  pinky: 17,18,19,20 (tip=20)
- Finger “extended vs curled” should be determined using angles:
  For index/middle/ring/pinky compute angle at PIP:
    Index angle: (5,6,8)
    Middle angle: (9,10,12)
    Ring angle: (13,14,16)
    Pinky angle: (17,18,20)
  Straight if angle > 160°, curled if angle < 140° (constants).
- Thumb straight check using angle (2,3,4) > 160°, curled if < 140°.
- OK_SIGN / PINCH: use normalized Euclidean distance between thumb tip (4) and index tip (8).
  Use hysteresis thresholds to avoid flicker:
    startPinchThreshold = 0.06
    endPinchThreshold   = 0.08

Stability requirements:
- Implement a simple state machine:
  - Each gesture must be continuously detected for HOLD_MS (e.g., 200ms) before becoming “active”.
  - Gesture must be absent for RELEASE_MS (e.g., 150ms) before deactivating.
  - Add COOLDOWN_MS (e.g., 400ms) to prevent rapid toggling between gestures.
- If multiple gestures match, choose the best one using a priority list (e.g., OK_SIGN > PINCH > POINT > PEACE > THUMBS_UP > FIST > OPEN_PALM).
- Show current gesture name in a HUD.

3) Image overlay system
- When a gesture becomes active, display the mapped image as an overlay on top of the video:
  - Centered on screen by default
  - Smooth fade-in + slight scale pop
  - When gesture ends, fade out
- Preload all images at startup.
- Allow per-gesture settings: size, position (center / top-left / etc.), and optional rotation.
- Provide a single mapping object in main.js like:

const GESTURE_TO_IMAGE = {
  POINT: { src: "./assets/point.png",  width: 280 },
  OPEN_PALM: { src: "./assets/flower.png", width: 260 },
  ...
};

(Use the exact filenames I attach.)

UI / UX REQUIREMENTS
- Clean layout: a camera preview with overlay, plus a control bar.
- Controls:
  - Start Camera
  - Stop Camera
  - Toggle Debug Overlay
- HUD text showing:
  - FPS
  - Detected gesture
  - Confidence/stability timer (how long held)
  - Pinch distance (if used)

PRIVACY
- Add on-page text: “All processing happens on your device. No video is uploaded.”

DELIVERABLES (output full code)
Provide a complete mini-project with:
- index.html
- styles.css
- main.js

Include:
- How to run locally (VS Code Live Server OR `python -m http.server 8000`)
- Note that camera requires http://localhost (not file://)

IMPLEMENTATION NOTES
- Use requestAnimationFrame loop.
- Keep canvas size synced with video’s actual dimensions.
- Handle errors gracefully:
  - If camera permission denied -> show message in HUD
  - If model fails to load -> show message
- Use CDN imports:
  https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14

ACCEPTANCE CRITERIA
- I can run locally and see my hand landmarks (when debug on).
- When I make each gesture, the correct attached image appears smoothly and consistently (no flicker).
- No backend; works fully in-browser.

Now implement it. Output all three files completely.
Before finalizing the mapping, ask me for the exact filenames of my attached images if you can’t infer them.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/77849060-749d-4f1c-a617-d9108584263f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
