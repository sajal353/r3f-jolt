import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * One clip at a time, crossfaded. Stopping the last clip and fading the next
 * one in from nothing leaves the blend short of full weight, and three.js fills
 * the shortfall with the bind pose — a T-pose flash on every change. A
 * crossfade keeps the weights summing to one throughout.
 */
export const createAnimator = (
  root: Object3D,
  clips: readonly AnimationClip[],
  initial: string,
) => {
  const mixer = new AnimationMixer(root);
  const actionOf = (name: string) => {
    const clip = clips.find((each) => each.name === name);
    return clip ? mixer.clipAction(clip) : null;
  };

  let current: AnimationAction | null = actionOf(initial);
  current?.play();
  // Posed now, so the first frame does not draw the bind pose.
  mixer.update(0);

  let whenDone: (() => void) | null = null;

  const fadeTo = (next: AnimationAction, fade: number) => {
    next.play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    current = next;
  };

  const play = (name: string, fade = 0.3) => {
    const next = actionOf(name);
    if (!next || next === current) return;
    whenDone = null;
    next.reset().setLoop(LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.timeScale = 1;
    fadeTo(next, fade);
  };

  /** Once, from `from`, at `timeScale` — negative plays it backwards — then `then`. */
  const playOnce = (
    name: string,
    { from, timeScale }: { from: number; timeScale: number },
    then: () => void,
    fade = 0.1,
  ) => {
    const next = actionOf(name);
    if (!next) return;
    next.reset().setLoop(LoopOnce, 1);
    next.clampWhenFinished = true;
    next.timeScale = timeScale;
    next.time = from;
    whenDone = then;
    fadeTo(next, fade);
  };

  // Not run from inside the event: it fires during `mixer.update`, and
  // starting a crossfade there changes the active actions mid-update, which
  // can blend one frame short of full weight — a snap toward the bind pose.
  mixer.addEventListener("finished", function finished(event) {
    if (event.action !== current || !whenDone) return;
    const done = whenDone;
    whenDone = null;
    queueMicrotask(done);
  });

  return { mixer, play, playOnce };
};

export type Animator = ReturnType<typeof createAnimator>;

/** A clip that ends standing, started on a frame that is lying down. */
export interface GetUpMove {
  clip: string;
  from: number;
  timeScale: number;
  /** Seconds to blend from the ragdoll into the clip's first frame. */
  blend: number;
}

/**
 * Mixamo get-ups, baked into the glb trimmed to a short still stretch lying
 * down — the time the ragdoll takes to blend in — then up to standing.
 */
export const GET_UP: Record<"faceUp" | "faceDown", GetUpMove> = {
  faceUp: { clip: "GetUp_FaceUp", from: 0, timeScale: 1, blend: 0.4 },
  faceDown: { clip: "GetUp_FaceDown", from: 0, timeScale: 1, blend: 0.4 },
};

/** Where a get-up's first frame puts the pelvis, and which way the head lies, from the root. */
export interface GetUpStart {
  pelvis: Vector3;
  heading: number;
}

const worldPosition = (root: Object3D, name: string) =>
  new Vector3().setFromMatrixPosition(root.getObjectByName(name)!.matrixWorld);

const headingOf = (pelvis: Vector3, head: Vector3) =>
  Math.hypot(head.x - pelvis.x, head.z - pelvis.z) < 0.15
    ? 0
    : Math.atan2(head.x - pelvis.x, head.z - pelvis.z);

const starts = new Map<string, GetUpStart>();

/** Sampled once per clip, on a throwaway copy at the origin. */
export const getUpStart = (
  source: Object3D,
  clips: readonly AnimationClip[],
  move: GetUpMove,
): GetUpStart => {
  const key = `${move.clip}@${move.from}`;
  const known = starts.get(key);
  if (known) return known;

  const copy = cloneSkinned(source);
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  const mixer = new AnimationMixer(copy);
  mixer.clipAction(clips.find((each) => each.name === move.clip)!).play();
  mixer.setTime(move.from);
  copy.updateMatrixWorld(true);

  const pelvis = worldPosition(copy, "pelvis");
  const start = { pelvis, heading: headingOf(pelvis, worldPosition(copy, "Head")) };
  mixer.uncacheRoot(copy);
  starts.set(key, start);
  return start;
};

export interface LyingBody {
  pelvis: Vector3;
  head: Vector3;
  leftShoulder: Vector3;
  rightShoulder: Vector3;
}

export interface GetUpPlan {
  move: GetUpMove;
  position: Vector3;
  yaw: number;
}

/**
 * Which get-up, and where to stand the character so that the clip's first
 * frame lies where the ragdoll does: its pelvis on the ragdoll's, its head
 * pointing the same way.
 */
/** Lying on its back: the chest, across the shoulders and up the spine, faces up. */
export const chestFacesUp = ({ pelvis, head, leftShoulder, rightShoulder }: LyingBody) =>
  new Vector3()
    .crossVectors(leftShoulder.clone().sub(rightShoulder), head.clone().sub(pelvis))
    .y > 0;

export const planGetUp = (
  body: LyingBody,
  start: (move: GetUpMove) => GetUpStart,
): GetUpPlan => {
  const { pelvis, head } = body;
  const move = chestFacesUp(body) ? GET_UP.faceUp : GET_UP.faceDown;
  const clip = start(move);

  const yaw = headingOf(pelvis, head) - clip.heading;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const position = new Vector3(
    pelvis.x - (clip.pelvis.x * cos + clip.pelvis.z * sin),
    pelvis.y - clip.pelvis.y,
    pelvis.z - (-clip.pelvis.x * sin + clip.pelvis.z * cos),
  );

  return { move, position, yaw };
};
