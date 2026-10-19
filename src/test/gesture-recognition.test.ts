import { beforeEach, describe, expect, it } from "vitest";
import { classify, DEBUG_DEFAULTS, resetRecognition, updateState, type Landmark } from "../../public/gesture/recognition.js";

const point = (x: number, y: number): Landmark => ({ x, y, z: 0 });
function hand(extended: number[] = []) {
  const lm = Array.from({ length: 21 }, () => point(0.5, 0.6));
  lm[0] = point(0.5, 0.75);
  lm[2] = point(0.36, 0.65); lm[3] = point(0.32, 0.62); lm[4] = point(0.34, 0.66);
  for (const [base, x] of [[5, 0.42], [9, 0.48], [13, 0.54], [17, 0.6]] as const) {
    lm[base] = point(x, 0.6);
    lm[base + 1] = point(x, 0.52);
    lm[base + 2] = point(x, extended.includes(base) ? 0.45 : 0.56);
    lm[base + 3] = point(x, extended.includes(base) ? 0.38 : 0.61);
  }
  return lm;
}
const face = { mouth: point(0.5, 0.63), nose: point(0.5, 0.53), chin: point(0.5, 0.73), width: 0.3, cx: 0.5 };

describe("Gesture rules", () => {
  beforeEach(resetRecognition);
  it("starts face debug off", () => { expect(DEBUG_DEFAULTS.face).toBe(false); });
  it("keeps hand debug on independently", () => { expect(DEBUG_DEFAULTS.hand).toBe(true); });
  it("recognizes the new pointing gesture", () => { expect(classify(hand([5])).raw).toBe("POINT"); });
  it("recognizes the new thumbs-up gesture", () => {
    const lm = hand(); lm[2] = point(0.34, 0.64); lm[3] = point(0.34, 0.54); lm[4] = point(0.34, 0.43);
    expect(classify(lm).raw).toBe("THUMBS_UP");
  });
  it("requires a face for laugh", () => {
    const lm = hand([5, 9, 13, 17]);
    expect(classify(lm, [lm], face).raw).toBe("LAUGH");
    expect(classify(lm, [lm], null).raw).not.toBe("LAUGH");
  });
  it("does not treat a wide open hand as prayer", () => {
    const lm = hand([5, 9, 13, 17]);
    expect(classify(lm, [lm], face).raw).not.toBe("PRAY");
  });
  it("recognizes aligned narrow prayer hands only with a face", () => {
    const lm = hand([5, 9, 13, 17]).map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.2 }));
    expect(classify(lm, [lm], face).raw).toBe("PRAY");
    expect(classify(lm, [lm], null).raw).not.toBe("PRAY");
  });
  it("does not call pointing away from lips shush", () => {
    const lm = hand([5]); expect(classify(lm, [lm], face).raw).toBe("POINT");
  });
  it("switches directly after a stable 200ms new pose", () => {
    updateState("LAUGH", 0); expect(updateState("LAUGH", 200)).toBe("LAUGH");
    updateState("PRAY", 210); expect(updateState("PRAY", 409)).toBe("LAUGH");
    expect(updateState("PRAY", 410)).toBe("PRAY");
  });
  it("keeps overlays through brief tracking loss but releases after 300ms", () => {
    updateState("POINT", 0); updateState("POINT", 200);
    expect(updateState("NONE", 499)).toBe("POINT");
    expect(updateState("NONE", 500)).toBe("NONE");
  });
  it("clears the previous active gesture on camera restart", () => {
    updateState("PRAY", 0); updateState("PRAY", 200); resetRecognition();
    expect(updateState("NONE", 201)).toBe("NONE");
  });
});