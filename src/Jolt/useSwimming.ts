import { useMemo } from "react";
import { Vector3 } from "three";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { CharacterApi } from "./useCharacter";
import type { JoltApi, WaterSample } from "./types";

export interface UseSwimmingOptions {
  /** How far below the surface the feet must be to swim. It floats there. */
  depth?: number;
  /** Horizontal speed while swimming, as a share of the walking speed. */
  speed?: number;
  /** How fast it rises or dives, in m/s. */
  verticalSpeed?: number;
  /** How quickly vertical speed settles, per second. */
  damping?: number;
  /** Carried along by the water's `flow`. */
  followFlow?: boolean;
}

export interface SwimmingApi {
  /** Pass to `update` as `overrideUpdate`. */
  overrideUpdate: (velocity: Vector3, up: Vector3, deltaTime: number) => Vector3;
  /** 1 rises, -1 dives, 0 floats at `depth`. Kept until changed. */
  setVertical: (value: number) => void;
  /**
   * Floats the feet this deep instead of `depth`, until `null`: for a shape of
   * your own that sits differently on the feet, such as a swimming position.
   */
  setFloatDepth: (value: number | null) => void;
  readonly swimming: boolean;
  /** Swimming and moving across the water rather than treading it. */
  readonly moving: boolean;
  /** Metres the feet are below the surface; 0 out of the water. */
  readonly depth: number;
}

/** Leaving needs the feet this much shallower than they float, so it can't flicker. */
const EXIT_MARGIN = 0.3;
const FLOAT_STIFFNESS = 2;
/** Horizontal speed, m/s, above which a swimmer counts as moving. */
const MOVING_SPEED = 0.3;

const defaults: Required<UseSwimmingOptions> = {
  depth: 1.2,
  speed: 0.6,
  verticalSpeed: 2,
  damping: 4,
  followFlow: true,
};

const createSwimming = (
  water: JoltApi["water"],
  character: CharacterApi | undefined,
  optionsRef: { readonly current: UseSwimmingOptions },
): SwimmingApi => {
  const sample: WaterSample = { depth: 0, surfaceLevel: 0, flow: new Vector3() };
  const result = new Vector3();
  const feet = new Vector3();
  const along = new Vector3();

  let swimming = false;
  let moving = false;
  let depth = 0;
  let vertical = 0;
  let floatOverride: number | null = null;

  const overrideUpdate = (velocity: Vector3, up: Vector3, deltaTime: number) => {
    if (!character) return velocity;

    const options = { ...defaults, ...optionsRef.current };
    const floatDepth = floatOverride ?? options.depth;
    const position = character.character.GetPosition();
    feet.set(position.GetX(), position.GetY(), position.GetZ());

    const wet = water.sample(feet, sample);
    depth = wet ? wet.depth : 0;
    swimming = swimming
      ? depth >= floatDepth - EXIT_MARGIN
      : depth >= options.depth;

    if (!swimming) {
      moving = false;
      return velocity;
    }

    const current = character.character.GetLinearVelocity();
    const rising =
      current.GetX() * up.x + current.GetY() * up.y + current.GetZ() * up.z;

    const float = Math.max(
      -options.verticalSpeed,
      Math.min(options.verticalSpeed, (depth - floatDepth) * FLOAT_STIFFNESS),
    );
    const target =
      vertical > 0
        ? Math.max(float, options.verticalSpeed * Math.sign(depth - floatDepth))
        : vertical < 0
          ? vertical * options.verticalSpeed
          : float;
    const settled =
      rising + (target - rising) * Math.min(1, options.damping * deltaTime);

    along.copy(up).multiplyScalar(velocity.dot(up));
    result.copy(velocity).sub(along);
    moving = result.length() > MOVING_SPEED;
    result.multiplyScalar(options.speed).addScaledVector(up, settled);

    if (options.followFlow) result.add(sample.flow);
    return result;
  };

  return {
    overrideUpdate,
    setVertical: (value) => {
      vertical = Math.sign(value);
    },
    setFloatDepth: (value) => {
      floatOverride = value;
    },
    get swimming() {
      return swimming;
    },
    get moving() {
      return moving;
    },
    get depth() {
      return depth;
    },
  };
};

/**
 * Swimming for a `useCharacter`, as an `overrideUpdate`: in water deeper than
 * `depth` the character floats with its feet at that depth instead of falling,
 * swims slower, rises or dives on `setVertical`, and drifts with the flow.
 * Wading in shallower water is left to the normal update.
 *
 * The shape is yours: read `moving` to put the character in a swimming
 * position with `setShape`, turned and placed to match your model.
 */
export const useSwimming = (
  character: CharacterApi | undefined,
  options: UseSwimmingOptions = {},
): SwimmingApi => {
  const api = useJolt();
  const optionsRef = useHandlerRef(options);

  return useMemo(
    () => createSwimming(api.water, character, optionsRef),
    [api, character, optionsRef],
  );
};
