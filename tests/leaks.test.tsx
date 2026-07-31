import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { useCar } from "@/Jolt/useCar";
import { useCharacter } from "@/Jolt/useCharacter";
import { useBox } from "@/Jolt/useBox";
import {
  expectNoAsserts,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const Ground = () => {
  useBox({ size: [50, 1, 50], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const direction = new Vector3(1, 0, 0);

const Character = () => {
  const [api] = useCharacter({
    position: [0, 3, 0],
    options: { height: { standing: 1.8, crouching: 0.9 } },
  });

  useFrame((_, delta) => {
    api?.update(direction, false, false, delta);
  });

  return null;
};

const CrouchingCharacter = () => {
  const [api] = useCharacter({ position: [0, 3, 0] });
  const frame = useRef(0);

  useFrame((_, delta) => {
    frame.current += 1;
    const n = frame.current;
    api?.update(direction, n % 30 === 0, n % 20 < 10, delta);
  });

  return null;
};

const Car = () => {
  const [api] = useCar({
    position: [0, 2, 0],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.3,
      width: 0.2,
      offsetForward: 1.2,
      offsetDown: 0.3,
    },
  });

  useFrame(() => {
    api?.update({
      forward: true,
      backward: false,
      left: false,
      right: true,
      handbrake: false,
      modifier: true,
    });
  });

  return null;
};

const cycles = async (element: React.ReactElement, frames: number) => {
  const module = await loadDebugModule();

  const run = async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        {element}
      </>,
    );
    await step(renderer, frames);
    await unmount(renderer);
  };

  await run();
  const baseline = module.JoltInterface.prototype.sGetFreeMemory();

  for (let i = 0; i < 4; i += 1) await run();

  return {
    baseline,
    after: module.JoltInterface.prototype.sGetFreeMemory(),
  };
};

describe("mount/unmount leak checks", () => {
  it("useCharacter leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Character />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCharacter crouch toggling does not leak", async () => {
    const { baseline, after } = await cycles(<CrouchingCharacter />, 60);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("useCar leaves the heap flat across cycles", async () => {
    const { baseline, after } = await cycles(<Car />, 30);
    expect(after).toBe(baseline);
    expectNoAsserts();
  });

  it("a driven character actually moves", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Character />
      </>,
    );

    await step(renderer, 90);
    await unmount(renderer);
    expectNoAsserts();
  });
});
