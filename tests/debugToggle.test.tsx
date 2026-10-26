import { useEffect, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, LineSegments, Mesh, Vector3, type Scene } from "three";
import { describe, expect, it } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useCar, type CarApi } from "@/Jolt/useCar";
import { useCharacter, type CharacterApi } from "@/Jolt/useCharacter";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import type { HingeConstraintApi } from "@/Jolt/useHingeConstraint";
import type { BodyApi } from "@/Jolt/internal/useBody";
import {
  expectNoAsserts,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
  type PhysicsRenderer,
} from "./harness";

const held: {
  scene: Scene | null;
  door: BodyApi<Jolt.BoxShape> | undefined;
  hinge: HingeConstraintApi | undefined;
  quiet: BodyApi<Jolt.BoxShape> | undefined;
  character: CharacterApi | undefined;
  car: CarApi | undefined;
} = {
  scene: null,
  door: undefined,
  hinge: undefined,
  quiet: undefined,
  character: undefined,
  car: undefined,
};

const CaptureScene = () => {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    held.scene = scene;
  }, [scene]);

  return null;
};

const sceneChildren = () => {
  if (!held.scene) throw new Error("scene was never captured");
  return held.scene.children;
};

const countOf = (type: typeof Mesh | typeof LineSegments | typeof Group) =>
  sceneChildren().filter((child) => child instanceof type).length;

/**
 * A door on a hinge, in the same component as the body it holds. Toggling
 * `<Physics debug>` used to rebuild the world, and this joint re-ran with the
 * door's old api — a constraint built on a body that had just been destroyed.
 */
const Door = () => {
  const [, door] = useBox({
    size: [1, 2, 0.1],
    position: [3, 3, 0],
    motionType: "dynamic",
  });
  const [hinge] = useHingeConstraint(null, door, {
    point: [3, 4, 0],
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
  });

  useEffect(() => {
    held.door = door;
    held.hinge = hinge;
  }, [door, hinge]);

  return null;
};

const QuietBox = () => {
  const [, quiet] = useBox({
    size: [1, 1, 1],
    position: [-3, 3, 0],
    motionType: "dynamic",
    debug: false,
  });

  useEffect(() => {
    held.quiet = quiet;
  }, [quiet]);

  return null;
};

const walk = new Vector3(1, 0, 0);

const Walker = () => {
  const [character] = useCharacter({ position: [0, 3, 6] });

  useEffect(() => {
    held.character = character;
  }, [character]);

  useFrame((_, delta) => {
    character?.update(walk, false, false, delta);
  });

  return null;
};

const Car = () => {
  const [car] = useCar({
    position: [0, 2, -8],
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.3,
      width: 0.2,
      offsetForward: 1.2,
      offsetDown: 0.3,
    },
  });

  useEffect(() => {
    held.car = car;
  }, [car]);

  return null;
};

const Ground = () => {
  useBox({ size: [50, 1, 50], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const World = ({ children }: { children?: ReactNode }) => (
  <>
    <CaptureScene />
    <Ground />
    <Door />
    {children}
  </>
);

const toggle = async (renderer: PhysicsRenderer, debug: boolean) => {
  await updatePhysics(renderer, <World />, { debug });
  await step(renderer, 5);
};

describe("<Physics debug> is live", () => {
  it("adds and removes overlays without rebuilding a body or a joint", async () => {
    const renderer = await renderPhysics(<World />);
    await step(renderer, 10);

    const door = held.door;
    const hinge = held.hinge;
    expect(door?.debugMesh).toBeNull();
    expect(countOf(LineSegments)).toBe(0);

    await toggle(renderer, true);

    expect(held.door).toBe(door);
    expect(held.hinge).toBe(hinge);
    expect(door?.debugMesh).toBeInstanceOf(Mesh);
    expect(countOf(LineSegments)).toBe(1);

    await toggle(renderer, false);

    expect(held.door).toBe(door);
    expect(door?.debugMesh).toBeNull();
    expect(countOf(Mesh)).toBe(0);
    expect(countOf(LineSegments)).toBe(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("the overlay lands on the body, not at the origin", async () => {
    const renderer = await renderPhysics(<World />);
    await step(renderer, 10);
    await toggle(renderer, true);

    const position = held.door?.body.GetPosition();
    const mesh = held.door?.debugMesh;
    expect(mesh?.position.x).toBeCloseTo(position?.GetX() ?? NaN, 3);
    expect(mesh?.position.y).toBeCloseTo(position?.GetY() ?? NaN, 3);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("a hook's own debug: false outranks the world's", async () => {
    const renderer = await renderPhysics(
      <World>
        <QuietBox />
      </World>,
    );
    await updatePhysics(
      renderer,
      <World>
        <QuietBox />
      </World>,
      { debug: true },
    );
    await step(renderer, 2);

    expect(held.quiet?.debugMesh).toBeNull();
    expect(held.door?.debugMesh).toBeInstanceOf(Mesh);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("covers the character and the car", async () => {
    const tree = (
      <World>
        <Walker />
        <Car />
      </World>
    );
    const renderer = await renderPhysics(tree);
    await step(renderer, 10);

    const character = held.character;
    const car = held.car;
    expect(character?.debugMeshStanding).toBeNull();
    expect(car?.debugGroup).toBeNull();

    await updatePhysics(renderer, tree, { debug: true });
    await step(renderer, 5);

    expect(held.character).toBe(character);
    expect(held.car).toBe(car);
    expect(character?.debugMeshStanding?.visible).toBe(true);
    expect(character?.debugMeshCrouching?.visible).toBe(false);
    expect(car?.debugGroup).toBeInstanceOf(Group);

    await updatePhysics(renderer, tree, { debug: false });
    await step(renderer, 2);

    expect(character?.debugMeshStanding).toBeNull();
    expect(car?.debugGroup).toBeNull();
    expect(countOf(Group)).toBe(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("toggling leaves the Jolt heap flat", async () => {
    const module = await loadDebugModule();
    const renderer = await renderPhysics(<World />);
    await step(renderer, 10);
    await toggle(renderer, true);
    await toggle(renderer, false);

    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await toggle(renderer, true);
      await toggle(renderer, false);
    }

    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);

    await unmount(renderer);
    expectNoAsserts();
  });
});
