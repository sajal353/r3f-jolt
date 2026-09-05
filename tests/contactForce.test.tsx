import { describe, expect, it } from "vitest";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { usePlane } from "@/Jolt/usePlane";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import type { ContactInfo } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

/**
 * The pooled `ContactInfo` is reused between events, so a test that keeps one
 * would be reading whatever landed last. Only the numbers are copied out.
 */
interface Landing {
  impactSpeed: number;
  impulse: number;
  bodyID: number;
}

const landings: Record<string, Landing[]> = {};

const record = (name: string, contact: ContactInfo) => {
  (landings[name] ??= []).push({
    impactSpeed: contact.impactSpeed,
    impulse: contact.impulse,
    bodyID: contact.bodyID,
  });
};

const firstLanding = (name: string) => {
  const found = landings[name];
  if (!found?.length) throw new Error(`${name} never reported a contact`);
  return found[0];
};

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 40 });
  return null;
};

const Faller = ({
  name,
  height,
  mass,
  contactForce = true,
  x = 0,
}: {
  name: string;
  height: number;
  mass: number;
  contactForce?: boolean;
  x?: number;
}) => {
  const [, api] = useSphere({
    position: [x, height + 0.5, 0],
    radius: 0.5,
    motionType: "dynamic",
    mass,
  });

  useBodyContacts(
    api?.body,
    { onEnter: (contact) => record(name, contact) },
    { contactForce },
  );

  return null;
};

/** Kinematic and immovable, but it reports a real inverse mass to Jolt. */
const KinematicSlab = ({ x }: { x: number }) => {
  useBox({
    position: [x, 0.5, 0],
    size: [4, 1, 4],
    motionType: "kinematic",
    mass: 8000,
  });
  return null;
};

describe("contact force", () => {
  it("reports a closing speed that follows the drop height", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="low" height={2} mass={1} x={0} />
        <Faller name="high" height={8} mass={1} x={10} />
      </>,
    );

    await step(renderer, 120);

    const low = firstLanding("low");
    const high = firstLanding("high");

    // Free fall: v = sqrt(2gh), so four times the height is twice the speed.
    expect(low.impactSpeed).toBeGreaterThan(5.5);
    expect(low.impactSpeed).toBeLessThan(7);
    expect(high.impactSpeed / low.impactSpeed).toBeGreaterThan(1.8);
    expect(high.impactSpeed / low.impactSpeed).toBeLessThan(2.2);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("scales the impulse with mass at the same speed", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="light" height={2} mass={1} x={0} />
        <Faller name="heavy" height={2} mass={4} x={10} />
      </>,
    );

    await step(renderer, 120);

    const light = firstLanding("light");
    const heavy = firstLanding("heavy");

    expect(heavy.impactSpeed).toBeCloseTo(light.impactSpeed, 1);
    expect(heavy.impulse / light.impulse).toBeCloseTo(4, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * The guard this test exists for: a kinematic body reports a real inverse
   * mass — 0.000125 for the slab here — while the solver treats it as
   * immovable. Keying the effective mass on the number rather than on
   * `IsDynamic()` makes the same drop read softer onto a platform than onto the
   * ground, silently.
   */
  it("treats a kinematic body as immovable, like static ground", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="onGround" height={3} mass={1} x={0} />
        <KinematicSlab x={20} />
        <Faller name="onSlab" height={4} mass={1} x={20} />
      </>,
    );

    await step(renderer, 120);

    const onGround = firstLanding("onGround");
    const onSlab = firstLanding("onSlab");

    // Both fell three metres: the slab's surface is a metre above the floor,
    // so its sphere starts a metre higher.
    expect(onSlab.impactSpeed).toBeCloseTo(onGround.impactSpeed, 1);
    expect(onSlab.impulse).toBeCloseTo(onGround.impulse, 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("stays at zero for a subscriber that did not ask", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Faller name="silent" height={4} mass={1} contactForce={false} />
      </>,
    );

    await step(renderer, 120);

    const silent = firstLanding("silent");
    expect(silent.impactSpeed).toBe(0);
    expect(silent.impulse).toBe(0);
    // The rest of the payload still arrives.
    expect(silent.bodyID).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports nothing on exit, and settles to zero at rest", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Resting />
      </>,
    );

    await step(renderer, 150);

    const stays = landings.resting ?? [];
    expect(stays.length).toBeGreaterThan(5);

    // The first contact is the landing; by the end it is resting on the plane.
    expect(stays[0].impactSpeed).toBeGreaterThan(1);
    expect(stays[stays.length - 1].impactSpeed).toBeLessThan(0.2);

    const exits = landings.restingExit ?? [];
    for (const exit of exits) {
      expect(exit.impactSpeed).toBe(0);
      expect(exit.impulse).toBe(0);
    }

    await unmount(renderer);
    expectNoAsserts();
  });
});

const Resting = () => {
  const [, api] = useSphere({
    position: [0, 3, 0],
    radius: 0.5,
    motionType: "dynamic",
    mass: 2,
    allowSleeping: false,
  });

  useBodyContacts(
    api?.body,
    {
      onEnter: (contact) => record("resting", contact),
      onStay: (contact) => record("resting", contact),
      onExit: (contact) => record("restingExit", contact),
    },
    { contactForce: true },
  );

  return null;
};
