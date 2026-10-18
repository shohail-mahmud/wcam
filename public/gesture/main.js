// Gesture Overlay — in-browser hand tracking with MediaPipe Tasks Vision.
import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---------- Mapping (edit here) ----------
// position: center | top-left | top-right | bottom-left | bottom-right | hand
// Face-aware gestures (need your face visible): LAUGH, PRAY, SHUSH
const GESTURE_TO_IMAGE = {
  LAUGH:   { src: "./assets/laugh.png",  width: 280, position: "center" }, // open hand covering mouth
  PRAY:    { src: "./assets/pray.png",   width: 280, position: "center" }, // both palms together in front of chin
  SHUSH:   { src: "./assets/shush.png",  width: 260, position: "center" }, // index finger on lips
  OK_SIGN: { src: "./assets/ok.png",     width: 280, position: "center", rotation: 0 },
  PINCH:   { src: "./assets/scheme.png", width: 260, position: "center", zoomWithPinch: true },
  // OPEN_PALM / FIST / POINT / PEACE / THUMBS_UP are detected but unmapped.
};

// ---------- Constants ----------
const STRAIGHT_DEG = 160;
const CURLED_DEG = 140;
const START_PINCH = 0.06;
const END_PINCH = 0.08;
const HOLD_MS = 200;
const RELEASE_MS = 150;
const COOLDOWN_MS = 400;
const FACE_MEMORY_MS = 600; // keep last face while a hand covers it
const PRIORITY = ["PRAY", "SHUSH", "LAUGH", "OK_SIGN", "PINCH", "POINT", "PEACE", "THUMBS_UP", "FIST", "OPEN_PALM"];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("debug"), ctx = canvas.getContext("2d");
const overlayImg = $("overlayImg"), placeholder = $("placeholder");
const startBtn = $("startBtn"), stopBtn = $("stopBtn"), debugBtn = $("debugBtn");
const hud = { status: $("hudStatus"), fps: $("hudFps"), raw: $("hudRaw"), gesture: $("hudGesture"), held: $("hudHeld"), pinch: $("hudPinch"), face: $("hudFace") };

let landmarker = null, faceLandmarker = null, lastFace = null, lastFaceAt = -Infinity, stream = null, rafId = null, debug = true;
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

// ---------- Geometry ----------
function angleAt(a, b, c) {
  const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
  const m = Math.hypot(...v1) * Math.hypot(...v2) || 1e-6;
  return (Math.acos(Math.min(1, Math.max(-1, dot / m))) * 180) / Math.PI;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function fingerState(deg) {
  if (deg > STRAIGHT_DEG) return "straight";
  if (deg < CURLED_DEG) return "curled";
  return "semi";
}

// ---------- Gesture classification ----------
let pinchActive = false;
function fingerStates(lm) {
  return {
    thumb: fingerState(angleAt(lm[2], lm[3], lm[4])),
    index: fingerState(angleAt(lm[5], lm[6], lm[8])),
    middle: fingerState(angleAt(lm[9], lm[10], lm[12])),
    ring: fingerState(angleAt(lm[13], lm[14], lm[16])),
    pinky: fingerState(angleAt(lm[17], lm[18], lm[20])),
  };
}

// Face reference points from FaceLandmarker (478 pts)
function faceInfo(f) {
  const mouth = { x: (f[13].x + f[14].x) / 2, y: (f[13].y + f[14].y) / 2 };
  const width = dist(f[234], f[454]) || 0.2; // cheek to cheek
  return { mouth, width, nose: f[1], chin: f[152], cx: (f[234].x + f[454].x) / 2 };
}

// Gestures that combine hands + face
function faceGestures(hands, face, matches) {
  if (!face) return;
  const W = face.width;
  for (const lm of hands) {
    const s = fingerStates(lm);
    const up = ["index", "middle", "ring", "pinky"].filter((f) => s[f] !== "curled").length;
    // SHUSH: index up, others curled, index tip on lips
    if (s.index !== "curled" && s.middle === "curled" && s.ring === "curled" && s.pinky === "curled" &&
        dist(lm[8], face.mouth) < 0.35 * W) matches.add("SHUSH");
    // LAUGH: open-ish hand whose palm covers the mouth
    const palm = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
    if (up >= 3 && (dist(lm[9], face.mouth) < 0.45 * W || dist(palm, face.mouth) < 0.45 * W))
      matches.add("LAUGH");
  }
  // PRAY: two hands, palms pressed together, in front of chin / below nose
  if (hands.length === 2) {
    const [a, b] = hands;
    const mid = { x: (a[8].x + b[8].x) / 2, y: (a[8].y + b[8].y) / 2 };
    if (dist(a[8], b[8]) < 0.45 * W && dist(a[9], b[9]) < 0.6 * W &&
        Math.abs(mid.x - face.cx) < 0.6 * W &&
        mid.y > face.nose.y - 0.4 * W && mid.y < face.chin.y + 1.2 * W) matches.add("PRAY");
  }
}

function classify(lm, hands = [lm], face = null) {
  const s = {
    thumb: fingerState(angleAt(lm[2], lm[3], lm[4])),
    index: fingerState(angleAt(lm[5], lm[6], lm[8])),
    middle: fingerState(angleAt(lm[9], lm[10], lm[12])),
    ring: fingerState(angleAt(lm[13], lm[14], lm[16])),
    pinky: fingerState(angleAt(lm[17], lm[18], lm[20])),
  };
  // Normalize pinch distance by hand size (wrist -> middle MCP) so it's scale-invariant-ish,
  // but keep the raw normalized-image distance as the primary metric per spec.
  const pinchDist = dist(lm[4], lm[8]);
  if (!pinchActive && pinchDist < START_PINCH) pinchActive = true;
  else if (pinchActive && pinchDist > END_PINCH) pinchActive = false;

  const S = (f) => s[f] === "straight";
  const C = (f) => s[f] === "curled";
  const notCurled = (f) => s[f] !== "curled";
  const matches = new Set();

  if (pinchActive) {
    matches.add("PINCH");
    if (notCurled("middle") && notCurled("ring") && notCurled("pinky")) matches.add("OK_SIGN");
  }
  if (S("index") && C("middle") && C("ring") && C("pinky") && !pinchActive) matches.add("POINT");
  if (S("index") && S("middle") && C("ring") && C("pinky")) matches.add("PEACE");
  // thumbs up: thumb straight, tip above its MCP (smaller y), other fingers curled
  if (S("thumb") && lm[4].y < lm[2].y - 0.05 && C("index") && C("middle") && C("ring") && C("pinky"))
    matches.add("THUMBS_UP");
  if (C("index") && C("middle") && C("ring") && C("pinky") && !S("thumb")) matches.add("FIST");
  if (S("thumb") && S("index") && S("middle") && S("ring") && S("pinky") && !pinchActive)
    matches.add("OPEN_PALM");

  faceGestures(hands, face, matches);
  if (hands.length === 2 && matches.has("PRAY")) matches.delete("FIST");
  const raw = PRIORITY.find((g) => matches.has(g)) || "NONE";
  return { raw, pinchDist };
}

// ---------- Stability state machine ----------
const sm = { active: "NONE", candidate: "NONE", candidateSince: 0, lastSeenActive: 0, activeSince: 0, lastChange: -Infinity };
function updateState(raw, now) {
  if (raw === sm.active && raw !== "NONE") sm.lastSeenActive = now;
  if (raw !== sm.candidate) { sm.candidate = raw; sm.candidateSince = now; }

  // Deactivate after RELEASE_MS absence
  if (sm.active !== "NONE" && raw !== sm.active && now - sm.lastSeenActive > RELEASE_MS) {
    sm.active = "NONE"; sm.lastChange = now;
  }
  // Activate after HOLD_MS + cooldown
  if (
    sm.candidate !== "NONE" && sm.candidate !== sm.active && sm.active === "NONE" &&
    now - sm.candidateSince >= HOLD_MS && now - sm.lastChange >= COOLDOWN_MS
  ) {
    sm.active = sm.candidate; sm.activeSince = now; sm.lastSeenActive = now; sm.lastChange = now;
  }
  return sm.active;
}

// ---------- Overlay ----------
let shownGesture = "NONE", currentZoom = 1;
function placeOverlay(cfg, lm, pinchDist) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
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
  overlayImg.style.width = `${cfg.width}px`;
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
    if (debug) {
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
    if (debug) for (const h of res.landmarks) {
      drawer.drawConnectors(h, HandLandmarker.HAND_CONNECTIONS, { color: "#3fa9ff", lineWidth: 3 });
      drawer.drawLandmarks(h, { color: "#ffffff", fillColor: "#ff4d8d", radius: 4 });
    }
  } else {
    pinchActive = false;
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
  startBtn.disabled = true;
  try {
    await loadModel();
  } catch (e) {
    console.error(e); setStatus("Model failed to load", true); startBtn.disabled = false; return;
  }
  try {
    setStatus("Requesting camera…");
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
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
  updateState("NONE", Infinity); sm.active = "NONE"; renderOverlay("NONE");
  placeholder.style.display = "grid";
  startBtn.disabled = false; stopBtn.disabled = true;
  setStatus("Stopped"); hud.fps.textContent = "–"; hud.gesture.textContent = "NONE";
}
startBtn.onclick = start;
stopBtn.onclick = stop;
debugBtn.onclick = () => {
  debug = !debug; debugBtn.textContent = `Debug: ${debug ? "ON" : "OFF"}`;
  if (!debug) ctx.clearRect(0, 0, canvas.width, canvas.height);
};
