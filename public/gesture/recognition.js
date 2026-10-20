export const DEBUG_DEFAULTS = { hand: true, face: false };
const STRAIGHT_DEG = 160;
const CURLED_DEG = 140;
const START_PINCH = 0.3;
const END_PINCH = 0.42;
const HOLD_MS = 200;
const RELEASE_MS = 300;
const PRIORITY = ["PRAY", "SHUSH", "LAUGH", "OK_SIGN", "THUMBS_UP", "POINT", "PEACE", "FIST", "OPEN_PALM", "PINCH"];
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
export function faceInfo(f) {
  const mouth = { x: (f[13].x + f[14].x) / 2, y: (f[13].y + f[14].y) / 2 };
  const width = dist(f[234], f[454]) || 0.2; // cheek to cheek
  return { mouth, width, nose: f[1], chin: f[152], cx: (f[234].x + f[454].x) / 2 };
}

// Gestures that combine hands + face
function faceGestures(hands, face, matches) {
  if (!face) return;
  const W = face.width;
  const palmC = (lm) => {
    const ids = [0, 5, 9, 13, 17];
    return { x: ids.reduce((a, i) => a + lm[i].x, 0) / 5, y: ids.reduce((a, i) => a + lm[i].y, 0) / 5 };
  };
  const handLen = (lm) => dist(lm[0], lm[9]) || 1e-3;
  const palmWidth = (lm) => dist(lm[5], lm[17]);
  const pointsUp = (lm) => lm[0].y - lm[12].y > 0.6 * handLen(lm); // fingertips well above wrist

  for (const lm of hands) {
    const s = fingerStates(lm);
    const notCurled = ["index", "middle", "ring", "pinky"].filter((f) => s[f] !== "curled").length;
    const p = palmC(lm);
    // SHUSH: index up, others curled, index tip on lips
    if (s.index !== "curled" && s.middle === "curled" && s.ring === "curled" && s.pinky === "curled" &&
        Math.abs(lm[8].x - face.mouth.x) < 0.22 * W &&
         Math.min(dist(lm[8], face.mouth), dist(lm[7], face.mouth)) < 0.3 * W && lm[8].y < lm[6].y) matches.add("SHUSH");
    // LAUGH: open hand, palm facing camera (wide), covering mouth region, not pointing straight up
    const nearMouth = dist(p, face.mouth) < 0.42 * W || dist(lm[9], face.mouth) < 0.35 * W;
    const wide = palmWidth(lm) > 0.65 * handLen(lm);
    if (notCurled >= 3 && nearMouth && wide) matches.add("LAUGH");
  }

  const inPrayZone = (pt) =>
    Math.abs(pt.x - face.cx) < 0.42 * W && pt.y > face.mouth.y - 0.15 * W && pt.y < face.chin.y + 0.85 * W;

  if (hands.length === 2) {
    // PRAY: two hands, palms pressed together, fingers up, in front of chin
    const [a, b] = hands;
    const mid = { x: (a[9].x + b[9].x) / 2, y: (a[9].y + b[9].y) / 2 };
    const together = dist(palmC(a), palmC(b)) < 0.42 * W && dist(a[8], b[8]) < 0.35 * W;
    if (together && inPrayZone(mid) && (pointsUp(a) && pointsUp(b))) matches.add("PRAY");
  } else if (hands.length === 1) {
    // Pressed palms often merge into ONE detected hand: sideways (narrow) hand, fingers up, in front of chin
    const lm = hands[0];
    const s = fingerStates(lm);
    const notCurled = ["index", "middle", "ring", "pinky"].filter((f) => s[f] !== "curled").length;
    const narrow = palmWidth(lm) < 0.42 * handLen(lm);
    const aligned = Math.abs(lm[8].x - lm[20].x) < 0.45 * handLen(lm);
    if (notCurled >= 3 && narrow && aligned && pointsUp(lm) && inPrayZone(palmC(lm))) matches.add("PRAY");
  }
}

export function classify(lm, hands = [lm], face = null) {
  const s = {
    thumb: fingerState(angleAt(lm[2], lm[3], lm[4])),
    index: fingerState(angleAt(lm[5], lm[6], lm[8])),
    middle: fingerState(angleAt(lm[9], lm[10], lm[12])),
    ring: fingerState(angleAt(lm[13], lm[14], lm[16])),
    pinky: fingerState(angleAt(lm[17], lm[18], lm[20])),
  };
  // Normalize pinch distance by hand size (wrist -> middle MCP) so it's scale-invariant-ish,
  // but keep the raw normalized-image distance as the primary metric per spec.
  const handSize = dist(lm[0], lm[9]) || 1e-3;
  const pinchDist = dist(lm[4], lm[8]) / handSize;
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
  if (S("index") && dist(lm[8], lm[5]) > 0.85 * handSize && C("middle") && C("ring") && C("pinky") && !pinchActive) matches.add("POINT");
  if (S("index") && S("middle") && C("ring") && C("pinky")) matches.add("PEACE");
  // thumbs up: thumb straight, tip above its MCP (smaller y), other fingers curled
  if (S("thumb") && lm[2].y - lm[4].y > 0.45 * handSize && dist(lm[4], lm[5]) > 0.65 * handSize && C("index") && C("middle") && C("ring") && C("pinky"))
    matches.add("THUMBS_UP");
  if (C("index") && C("middle") && C("ring") && C("pinky") && !S("thumb")) matches.add("FIST");
  if (S("thumb") && S("index") && S("middle") && S("ring") && S("pinky") && !pinchActive)
    matches.add("OPEN_PALM");

  faceGestures(hands, face, matches);
  const raw = PRIORITY.find((g) => matches.has(g)) || "NONE";
  return { raw, pinchDist };
}

// ---------- Stability state machine ----------
export const sm = { active: "NONE", candidate: "NONE", candidateSince: 0, lastSeenActive: 0, activeSince: 0 };
export function updateState(raw, now) {
  if (raw === sm.active && raw !== "NONE") sm.lastSeenActive = now;
  if (raw !== sm.candidate) { sm.candidate = raw; sm.candidateSince = now; }
  if (raw !== "NONE" && raw !== sm.active && now - sm.candidateSince >= HOLD_MS) {
    sm.active = raw; sm.activeSince = now; sm.lastSeenActive = now;
  } else if (raw === "NONE" && now - sm.lastSeenActive >= RELEASE_MS) {
    sm.active = "NONE";
  }
  return sm.active;
}
export function resetRecognition() {
  pinchActive = false;
  Object.assign(sm, { active: "NONE", candidate: "NONE", candidateSince: 0, lastSeenActive: 0, activeSince: 0 });
}
export function clearPinch() { pinchActive = false; }
