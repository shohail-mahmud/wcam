// Gesture Overlay — in-browser hand tracking with MediaPipe Tasks Vision.
import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import { classify, sm, updateState, resetRecognition, clearPinch, DEBUG_DEFAULTS } from "./recognition.js";

// ---------- Mapping (edit here) ----------
// position: center | top-left | top-right | bottom-left | bottom-right | hand
// Face-aware gestures (need your face visible): LAUGH, PRAY, SHUSH
const GESTURE_TO_IMAGE = {
  LAUGH:   { src: "./assets/laugh.png",  width: 280, position: "center" }, // open hand covering mouth
  PRAY:    { src: "./assets/pray.png",   width: 280, position: "center" }, // both palms together in front of chin
  SHUSH:   { src: "./assets/shush.png",  width: 260, position: "center" }, // index finger on lips
  OK_SIGN: { src: "./assets/ok.png",     width: 280, position: "center", rotation: 0 },
  POINT: { src: "/__l5e/assets-v1/e06cd893-ce8b-4feb-8273-0d1264054d07/point.png", width: 280, position: "center" },
  THUMBS_UP: { src: "/__l5e/assets-v1/aa9c1860-7e62-4fcb-b0bd-b7e2511bc4eb/thumbs-up.png", width: 280, position: "center" },
  // OPEN_PALM / FIST / PEACE / PINCH are detected but unmapped.
};

// ---------- Constants ----------
const FACE_MEMORY_MS = 800;
const END_PINCH = 0.42;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("debug"), ctx = canvas.getContext("2d");
const overlayImg = $("overlayImg"), placeholder = $("placeholder");
const startBtn = $("startBtn"), stopBtn = $("stopBtn"), handDebug = $("handDebug"), faceDebug = $("faceDebug"), fullscreenBtn = $("fullscreenBtn"), stage = $("stage");
const hud = { status: $("hudStatus"), fps: $("hudFps"), raw: $("hudRaw"), gesture: $("hudGesture"), held: $("hudHeld"), pinch: $("hudPinch"), face: $("hudFace") };

let landmarker = null, faceLandmarker = null, lastFace = null, lastFaceAt = -Infinity, stream = null, rafId = null;
handDebug.checked = DEBUG_DEFAULTS.hand;
faceDebug.checked = DEBUG_DEFAULTS.face;
let lastVideoTime = -1, fpsFrames = 0, fpsT0 = performance.now();
const drawer = new DrawingUtils(ctx);

function setStatus(text, isError = false) {
  hud.status.textContent = text;
  hud.status.classList.toggle("err", isError);
}

// ---------- Preload ----------
const preloaded = {};
for (const [g, cfg] of Object.entries(GESTURE_TO_IMAGE)) {
  const img = new Image(); img.src = cfg.src; preloaded[g] = img;
}

// ---------- Model ----------
async function loadModel() {
  if (landmarker) return landmarker;
  setStatus("Loading model…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  const opts = (delegate) => ({
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate,
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
  const faceOpts = (delegate) => ({
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate,
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, opts("GPU"));
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, faceOpts("GPU"));
  } catch {
    landmarker = await HandLandmarker.createFromOptions(vision, opts("CPU"));
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, faceOpts("CPU"));
  }
  return landmarker;
}

// ---------- Overlay ----------
let shownGesture = "NONE", currentZoom = 1;
function placeOverlay(cfg, lm, pinchDist) {
  const W = stage.clientWidth, H = stage.clientHeight;
  const m = 24 + cfg.width / 2;
  const pos = {
    center: [W / 2, H / 2], "top-left": [m, m], "top-right": [W - m, m],
    "bottom-left": [m, H - m], "bottom-right": [W - m, H - m],
  };
  let [x, y] = pos[cfg.position] || pos.center;
  if (cfg.position === "hand" && lm) { x = (1 - lm[9].x) * W; y = lm[9].y * H; }
  let scale = 1;
  if (cfg.zoomWithPinch && pinchDist != null) {
    const target = 0.7 + Math.min(1, pinchDist / END_PINCH) * 0.6;
    currentZoom += (target - currentZoom) * 0.2;
    scale = currentZoom;
  }
  overlayImg.style.left = `${x}px`;
  overlayImg.style.top = `${y}px`;
  overlayImg.style.width = `${Math.min(cfg.width, W * 0.65, H * 0.7)}px`;
  overlayImg.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${cfg.rotation || 0}deg)`;
}
function renderOverlay(active, lm, pinchDist) {
  const cfg = GESTURE_TO_IMAGE[active];
  if (active !== shownGesture) {
    shownGesture = active;
    if (cfg) {
      overlayImg.classList.remove("show");
      overlayImg.src = preloaded[active].src;
      overlayImg.style.transform = "translate(-50%,-50%) scale(0.8)";
      requestAnimationFrame(() => overlayImg.classList.add("show"));
    } else {
      overlayImg.classList.remove("show");
      overlayImg.style.transform = overlayImg.style.transform.replace(/scale\([^)]*\)/, "scale(0.8)");
    }
  }
  if (cfg && overlayImg.classList.contains("show")) placeOverlay(cfg, lm, pinchDist);
}

// ---------- Loop ----------
function loop() {
  rafId = requestAnimationFrame(loop);
  if (!landmarker || video.readyState < 2) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  }
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const res = landmarker.detectForVideo(video, now);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const fres = faceLandmarker ? faceLandmarker.detectForVideo(video, now) : null;
  if (fres && fres.faceLandmarks && fres.faceLandmarks.length) {
    lastFace = faceInfo(fres.faceLandmarks[0]); lastFaceAt = now;
    if (faceDebug.checked) {
      drawer.drawConnectors(fres.faceLandmarks[0], FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#ffd166", lineWidth: 2 });
      drawer.drawConnectors(fres.faceLandmarks[0], FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#ffd16688", lineWidth: 1 });
    }
  }
  const face = now - lastFaceAt < FACE_MEMORY_MS ? lastFace : null;
  hud.face.textContent = face ? (now === lastFaceAt ? "Detected" : "Held (covered)") : "Not found";

  let raw = "NONE", pinchDist = null, lm = null;
  if (res.landmarks && res.landmarks.length) {
    lm = res.landmarks[0];
    ({ raw, pinchDist } = classify(lm, res.landmarks, face));
    if (handDebug.checked) for (const h of res.landmarks) {
      drawer.drawConnectors(h, HandLandmarker.HAND_CONNECTIONS, { color: "#3fa9ff", lineWidth: 3 });
      drawer.drawLandmarks(h, { color: "#ffffff", fillColor: "#ff4d8d", radius: 4 });
    }
  } else {
    clearPinch();
  }

  const active = updateState(raw, now);
  renderOverlay(active, lm, pinchDist);

  fpsFrames++;
  if (now - fpsT0 >= 500) { hud.fps.textContent = ((fpsFrames * 1000) / (now - fpsT0)).toFixed(0); fpsFrames = 0; fpsT0 = now; }
  hud.raw.textContent = raw;
  hud.gesture.textContent = active;
  hud.held.textContent = active !== "NONE" ? `${Math.round(now - sm.activeSince)} ms`
    : raw !== "NONE" ? `${Math.round(now - sm.candidateSince)} ms…` : "0 ms";
  hud.pinch.textContent = pinchDist != null ? pinchDist.toFixed(3) : "–";
}

// ---------- Controls ----------
async function start() {
  if (startBtn.disabled || stream) return;
  startBtn.disabled = true;
  try {
    await loadModel();
  } catch (e) {
    console.error(e); setStatus("Model failed to load", true); startBtn.disabled = false; return;
  }
  try {
    setStatus("Requesting camera…");
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
    resetRecognition(); lastFace = null; lastFaceAt = -Infinity; lastVideoTime = -1;
    fpsFrames = 0; fpsT0 = performance.now();
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null;
    console.error(e);
    setStatus(e.name === "NotAllowedError" ? "Camera permission denied" : "Camera unavailable", true);
    startBtn.disabled = false; return;
  }
  placeholder.style.display = "none";
  stopBtn.disabled = false;
  setStatus("Running");
  loop();
}
function stop() {
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null; lastVideoTime = -1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resetRecognition(); lastFace = null; lastFaceAt = -Infinity; renderOverlay("NONE");
  hud.raw.textContent = "–"; hud.face.textContent = "–"; hud.held.textContent = "0 ms"; hud.pinch.textContent = "–";
  placeholder.style.display = "grid";
  startBtn.disabled = false; stopBtn.disabled = true;
  setStatus("Stopped"); hud.fps.textContent = "–"; hud.gesture.textContent = "NONE";
}
startBtn.onclick = start;
stopBtn.onclick = stop;
function redrawDebug() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
handDebug.onchange = redrawDebug;
faceDebug.onchange = redrawDebug;
fullscreenBtn.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch { setStatus("Fullscreen unavailable", true); }
};
document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Camera fullscreen");
  fullscreenBtn.title = document.fullscreenElement ? "Exit fullscreen" : "Camera fullscreen";
});
window.addEventListener("pagehide", stop);
