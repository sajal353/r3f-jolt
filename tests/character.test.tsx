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
});
