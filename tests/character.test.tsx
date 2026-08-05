import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";
import type { CharacterApi } from "@/Jolt/useCharacter";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

const held: { api?: CharacterApi; crouched: boolean } = { crouched: false };

const setHeld = (api: CharacterApi | undefined) => {
  held.api = api;
};

const still = new Vector3();

const Ground = () => {
  useBox({
    size: [40, 1, 40],
    position: [0, -0.5, 0],
    motionType: "static",
    material: { friction: 1 },
  });
  return null;
};

const Player = () => {
  const [api] = useCharacter({
    position: [0, 2, 0],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
    },
  });

  useEffect(() => {
    setHeld(api);
  }, [api]);

  useFrame((_, delta) => {
    api?.update(still, false, held.crouched, Math.min(delta, 1 / 30));
  });

  return null;
};

const feetY = () => {
  if (!held.api) throw new Error("character not ready");
  return held.api.character.GetPosition().GetY();
};

const SLOPE_ANGLE = 25 * (Math.PI / 180);
const WARMUP_FRAMES = 40;

const slope: { api?: CharacterApi; frames: number; airborne: number } = {
  frames: 0,
  airborne: 0,
};

const setSlopeApi = (api: CharacterApi | undefined) => {
  slope.api = api;
};

/** Tilted about +X, so the −z end is the high one and +z is downhill. */
const Slope = () => {
  useBox({
    size: [8, 0.4, 20],
    position: [0, 0, 0],
    rotation: [Math.sin(SLOPE_ANGLE / 2), 0, 0, Math.cos(SLOPE_ANGLE / 2)],
    motionType: "static",
    material: { friction: 1 },
  });
  return null;
};

const downhill = new Vector3(0, 0, 1);

const Walker = ({ stickToFloor }: { stickToFloor: boolean }) => {
  const [api] = useCharacter({
    position: [0, 4.8, -8],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
      moveSpeed: 6,
      enableStickToFloor: stickToFloor,
    },
  });

  useEffect(() => {
    setSlopeApi(api);
  }, [api]);

  useFrame((_, delta) => {
    if (!api) return;

    api.update(downhill, false, false, Math.min(delta, 1 / 30));

    slope.frames += 1;
    if (slope.frames > WARMUP_FRAMES && !api.character.IsSupported()) {
      slope.airborne += 1;
    }
  });

  return null;
};

describe("useCharacter", () => {
  it("rests on the floor standing and stays on it when crouching", async () => {
    held.crouched = false;
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Player />
      </>,
    );

    await step(renderer, 120);
    const standingY = feetY();

    // The floor's top face is y = 0 and a CharacterVirtual's position is its
    // feet, so a settled character sits at ~0.
    expect(standingY).toBeGreaterThan(-0.05);
    expect(standingY).toBeLessThan(0.05);

    held.crouched = true;
    await step(renderer, 120);
    const crouchingY = feetY();

    // Regression: both capsules were built with the standing shape's vertical
    // offset, so crouching dropped the feet by the difference between the two
    // offsets (0.45 here) and the character sank through the floor.
    expect(crouchingY).toBeGreaterThan(-0.05);
    expect(crouchingY).toBeLessThan(0.05);
    expect(Math.abs(crouchingY - standingY)).toBeLessThan(0.05);

    held.crouched = false;
    await step(renderer, 120);
    expect(Math.abs(feetY() - standingY)).toBeLessThan(0.05);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stays on the ground walking downhill only with stick-to-floor on", async () => {
    const walkDown = async (stickToFloor: boolean) => {
      slope.frames = 0;
      slope.airborne = 0;

      const renderer = await renderPhysics(
        <>
          <Slope />
          <Walker stickToFloor={stickToFloor} />
        </>,
      );

      // 6 m/s for ~1.7 s covers 10 m of a 20 m ramp: far enough to be a walk
      // downhill, short enough not to run off the bottom edge.
      await step(renderer, 140);
      const airborne = slope.airborne;
      await unmount(renderer);

      return airborne;
    };

    // Regression: the two branches were swapped, so `enableStickToFloor: true`
    // zeroed `mStickToFloorStepDown` — which is exactly how Jolt turns the
    // feature off. Walking down a slope launched the character off it every
    // step instead of holding it against the surface.
    const stuck = await walkDown(true);
    const loose = await walkDown(false);

    // 4 frames against 97 of the same 100: the handful are the initial drop
    // onto the ramp, before either configuration has landed.
    expect(stuck).toBeLessThan(10);
    expect(loose).toBeGreaterThan(80);

    expectNoAsserts();
  });
});
