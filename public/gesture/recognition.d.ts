export interface Landmark { x: number; y: number; z: number }
export interface FaceInfo { mouth: Landmark; width: number; nose: Landmark; chin: Landmark; cx: number }
export const DEBUG_DEFAULTS: { hand: boolean; face: boolean };
export const sm: { active: string; candidate: string; candidateSince: number; lastSeenActive: number; activeSince: number };
export function classify(lm: Landmark[], hands?: Landmark[][], face?: FaceInfo | null): { raw: string; pinchDist: number };
export function faceInfo(f: Landmark[]): FaceInfo;
export function updateState(raw: string, now: number): string;
export function resetRecognition(): void;
export function clearPinch(): void;