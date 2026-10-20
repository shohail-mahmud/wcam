// Gesture Overlay — on-device hand + face tracking (MediaPipe Tasks Vision 0.10.14).
// Rebuilt for robustness: models load independently, each falls back GPU -> CPU,
// and a per-frame error never kills the tracking loop.
import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import {
  classify, sm, updateState, resetRecognition, clearPinch, faceInfo, DEBUG_DEFAULTS,
} from "./recognition.js?v=3";

// ---------- Mapping (edit here) ----------
// position: center | top-left | top-right | bottom-left | bottom-right | hand
const GESTURE_TO_IMAGE = {
  LAUGH:     { src: "./assets/laugh.png", width: 280, position: "center" },
  PRAY:      { src: "./assets/pray.png",  width: 280, position: "center" },
  SHUSH:     { src: "./assets/shush.png", width: 260, position: "center" },
  OK_SIGN:   { src: "./assets/ok.png",    width: 280, position: "center" },
  POINT:     { src: "/__l5e/assets-v1/e06cd893-ce8b-4feb-8273-0d1264054d07/point.png", width: 280, position: "center" },
  THUMBS_UP: { src: "/__l5e/assets-v1/aa9c1860-7e62-4fcb-b0bd-b7e2511bc4eb/thumbs-up.png", width: 280, position: "center" },
};

const VISION_VERSION = "0.10.14";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const FACE_MEMORY_MS = 800;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("debug"), ctx = canvas.getContext("2d");
const overlayImg = $("overlayImg"), placeholder = $("placeholder"), stage = $("stage");
const startBtn = $("startBtn"), stopBtn = $("stopBtn"), fullscreenBtn = $("fullscreenBtn");
const handDebug = $("handDebug"), faceDebug = $("faceDebug");
const hud = {
  status: $("hudStatus"), fps: $("hudFps"), hands: $("hudHands"), raw: $("hudRaw"),
  gesture: $("hudGesture"), held: $("hudHeld"), pinch: $("hudPinch"), face: $("hudFace"),
};
handDebug.checked = DEBUG_DEFAULTS.hand;
faceDebug.checked = DEBUG_DEFAULTS.face;
const drawer = new DrawingUtils(ctx);

function setStatus(text, isError = false) {
  hud.status.textContent = text;
  hud.status.classList.toggle("err", isError);
}

// Preload overlay images
const preloaded = {};
for (const [g, cfg] of Object.entries(GESTURE_TO_IMAGE)) {
  const img = new Image(); img.src = cfg.src; preloaded[g] = img;
}

// ---------- Models ----------
let vision = null;
const models = { hand: null, face: null };
const delegates = { hand: null, face: null };

async function createModel(kind, delegate) {
  const common = { baseOptions: { delegate }, runningMode: "VIDEO" };
  if (kind === "hand") {
    return HandLandmarker.createFromOptions(vision, {
      ...common, baseOptions: { ...common.baseOptions, modelAssetPath: HAND_MODEL },
      numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  }
  return FaceLandmarker.createFromOptions(vision, {
    ...common, baseOptions: { ...common.baseOptions, modelAssetPath: FACE_MODEL },
    numFaces: 1,
  });
}

async function loadModel(kind) {
  if (models[kind]) return models[kind];
  for (const delegate of ["GPU", "CPU"]) {
    try {
      models[kind] = await createModel(kind, delegate);
      delegates[kind] = delegate;
      console.info(`[gesture] ${kind} model ready (${delegate})`);
      return models[kind];
    } catch (e) {
      console.warn(`[gesture] ${kind} model failed on ${delegate}`, e);
    }
  }
  throw new Error(`${kind} model unavailable`);
}

// If GPU detection crashes at runtime, rebuild that model on CPU once.
let switching = { hand: false, face: false };
async function fallbackToCpu(kind, err) {
  console.warn(`[gesture] ${kind} detection error on ${delegates[kind]}`, err);
  if (switching[kind]) return;
  if (delegates[kind] === "CPU") { models[kind] = null; return; }
  switching[kind] = true;
  try { models[kind]?.close(); } catch {}
  models[kind] = null;
  try {
    models[kind] = await createModel(kind, "CPU");
    delegates[kind] = "CPU";
  } catch (e) {
    console.error(`[gesture] ${kind} CPU fallback failed`, e);
  }
  switching[kind] = false;
}

async function loadAll() {
  setStatus("Loading model…");
  if (!vision) vision = await FilesetResolver.forVisionTasks(WASM_URL);
  // Hand tracking is required; face tracking is optional (only face gestures need it).
  const [hand, face] = await Promise.allSettled([loadModel("hand"), loadModel("face")]);
  if (hand.status === "rejected") throw hand.reason;
  if (face.status === "rejected") console.warn("[gesture] face tracking disabled");
}

// ---------- Overlay ----------
let shownGesture = "NONE";
function placeOverlay(cfg, lm) {
  const W = stage.clientWidth, H = stage.clientHeight;
  const m = 24 + cfg.width / 2;
  const pos = {
    center: [W / 2, H / 2], "top-left": [m, m], "top-right": [W - m, m],
    "bottom-left": [m, H - m], "bottom-right": [W - m, H - m],
  };
  let [x, y] = pos[cfg.position] || pos.center;
  if (cfg.position === "hand" && lm) { x = (1 - lm[9].x) * W; y = lm[9].y * H; }
  overlayImg.style.left = `${x}px`;
  overlayImg.style.top = `${y}px`;
  overlayImg.style.width = `${Math.min(cfg.width, W * 0.65, H * 0.7)}px`;
  overlayImg.style.transform = `translate(-50%,-50%) scale(1) rotate(${cfg.rotation || 0}deg)`;
}
function renderOverlay(active, lm) {
  const cfg = GESTURE_TO_IMAGE[active];
  if (active !== shownGesture) {
    shownGesture = active;
    overlayImg.classList.remove("show");
    if (cfg) {
      overlayImg.src = preloaded[active].src;
      overlayImg.style.transform = "translate(-50%,-50%) scale(0.8)";
      requestAnimationFrame(() => overlayImg.classList.add("show"));
    }
  }
  if (cfg && overlayImg.classList.contains("show")) placeOverlay(cfg, lm);
}

// ---------- Tracking loop ----------
let stream = null, rafId = null, running = false;
let lastVideoTime = -1, lastTs = 0, frameNo = 0;
let lastFace = null, lastFaceAt = -Infinity, lastFaceLm = null;
let fpsFrames = 0, fpsT0 = 0, errorCount = 0;

function nextTimestamp() {
  // MediaPipe requires strictly increasing timestamps per model.
  const t = performance.now();
  lastTs = t > lastTs ? t : lastTs + 1;
  return lastTs;
}

function trackFrame() {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  }
  const now = nextTimestamp();
  frameNo++;

  // Hands — every frame
  let hands = [];
  if (models.hand) {
    try { hands = models.hand.detectForVideo(video, now).landmarks || []; }
    catch (e) { fallbackToCpu("hand", e); }
  }

  // Face — every other frame keeps hand tracking smooth on slower machines
  if (models.face && frameNo % 2 === 0) {
    try {
      const fr = models.face.detectForVideo(video, now);
      if (fr.faceLandmarks?.length) {
        lastFaceLm = fr.faceLandmarks[0];
        lastFace = faceInfo(lastFaceLm);
        lastFaceAt = now;
      } else lastFaceLm = null;
    } catch (e) { fallbackToCpu("face", e); }
  }
  const faceFresh = now - lastFaceAt < 250;
  const face = now - lastFaceAt < FACE_MEMORY_MS ? lastFace : null;

  // Draw debug
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (faceDebug.checked && lastFaceLm && faceFresh) {
    drawer.drawConnectors(lastFaceLm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: "#ffd16699", lineWidth: 1 });
    drawer.drawConnectors(lastFaceLm, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#ffd166", lineWidth: 2 });
  }
  if (handDebug.checked) for (const h of hands) {
    drawer.drawConnectors(h, HandLandmarker.HAND_CONNECTIONS, { color: "#3fa9ff", lineWidth: 3 });
    drawer.drawLandmarks(h, { color: "#ffffff", fillColor: "#ff4d8d", radius: 4 });
  }

  // Classify
  let raw = "NONE", pinchDist = null, lm = null;
  if (hands.length) {
    lm = hands[0];
    ({ raw, pinchDist } = classify(lm, hands, face));
  } else clearPinch();
  const active = updateState(raw, now);
  renderOverlay(active, lm);

  // HUD
  fpsFrames++;
  if (now - fpsT0 >= 500) {
    hud.fps.textContent = ((fpsFrames * 1000) / (now - fpsT0)).toFixed(0);
    fpsFrames = 0; fpsT0 = now;
  }
  hud.hands.textContent = models.hand ? String(hands.length) : "Unavailable";
  hud.face.textContent = !models.face ? "Unavailable" : face ? (faceFresh ? "Detected" : "Held (covered)") : "Not found";
  hud.raw.textContent = raw;
  hud.gesture.textContent = active;
  hud.held.textContent = active !== "NONE" ? `${Math.round(now - sm.activeSince)} ms`
    : raw !== "NONE" ? `${Math.round(now - sm.candidateSince)} ms…` : "0 ms";
  hud.pinch.textContent = pinchDist != null ? pinchDist.toFixed(3) : "–";
}

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  if (video.readyState < 2 || !video.videoWidth) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  try {
    trackFrame();
    if (errorCount) { errorCount = 0; setStatus("Running"); }
  } catch (e) {
    errorCount++;
    console.error("[gesture] frame error", e);
    if (errorCount > 30) setStatus("Tracking error — see console", true);
  }
}

// ---------- Controls ----------
async function start() {
  if (running || startBtn.disabled) return;
  startBtn.disabled = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera needs https or localhost", true); startBtn.disabled = false; return;
  }
  // Ask for the camera first so the permission prompt appears immediately.
  try {
    setStatus("Requesting camera…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    console.error(e);
    stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null;
    setStatus(e.name === "NotAllowedError" ? "Camera permission denied"
      : e.name === "NotReadableError" ? "Camera in use by another app" : "Camera unavailable", true);
    startBtn.disabled = false; return;
  }
  placeholder.style.display = "none";
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    setStatus("Model failed to load — check connection", true);
    stop(true); return;
  }
  resetRecognition();
  lastFace = null; lastFaceAt = -Infinity; lastFaceLm = null;
  lastVideoTime = -1; frameNo = 0; errorCount = 0; fpsFrames = 0; fpsT0 = performance.now();
  running = true;
  stopBtn.disabled = false;
  setStatus(models.face ? "Running" : "Running (hand only)");
  loop();
}

function stop(keepStatus = false) {
  running = false;
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; video.srcObject = null; lastVideoTime = -1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resetRecognition(); lastFace = null; lastFaceAt = -Infinity; lastFaceLm = null;
  renderOverlay("NONE");
  for (const k of ["raw", "face", "pinch", "fps", "hands"]) hud[k].textContent = "–";
  hud.held.textContent = "0 ms"; hud.gesture.textContent = "NONE";
  placeholder.style.display = "flex";
  startBtn.disabled = false; stopBtn.disabled = true;
  if (keepStatus !== true) setStatus("Stopped");
}

startBtn.onclick = start;
stopBtn.onclick = () => stop();
handDebug.onchange = faceDebug.onchange = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
fullscreenBtn.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stage.requestFullscreen();
  } catch { setStatus("Fullscreen unavailable", true); }
};
document.addEventListener("fullscreenchange", () => {
  const fs = !!document.fullscreenElement;
  fullscreenBtn.setAttribute("aria-label", fs ? "Exit fullscreen" : "Camera fullscreen");
  fullscreenBtn.title = fs ? "Exit fullscreen" : "Camera fullscreen";
});
window.addEventListener("pagehide", () => stop());
