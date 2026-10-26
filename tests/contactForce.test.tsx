import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { usePlane } from "@/Jolt/usePlane";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import type Jolt from "jolt-physics";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ContactInfo } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

/**
 * The pooled `ContactInfo` is reused between events, so a test that keeps one
 * would be reading whatever landed last. Only the numbers are copied out.
 */
interface Landing {
  impactSpeed: number;
  impulse: number;
  frictionImpulse: number;
  bodyID: number;
}

const landings: Record<string, Landing[]> = {};

const record = (name: string, contact: ContactInfo) => {
  (landings[name] ??= []).push({
    impactSpeed: contact.impactSpeed,
    impulse: contact.impulse,
    frictionImpulse: contact.frictionImpulse,
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
    expect(silent.frictionImpulse).toBe(0);
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
      expect(exit.frictionImpulse).toBe(0);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("computes the estimate for each kind of event that was asked for", async () => {
    const renderer = await renderPhysics(
      <>
        <Slab />
        <EnteringOnly />
      </>,
    );

    await step(renderer, 150);

    // The faller asked only about entry, the slab only about persistence, and
    // both asked for the force. Neither subscription may starve the other: the
    // estimate is computed per pair, once, for the kinds someone is listening
    // for.
    const entered = firstLanding("enterOnly");
    expect(entered.impulse).toBeGreaterThan(0);

    const stays = landings.stayOnly ?? [];
    expect(stays.length).toBeGreaterThan(5);
    expect(Math.max(...stays.map((stay) => stay.impulse))).toBeGreaterThan(0);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("contact force against the solver", () => {
  /**
   * Ground truth is the momentum each body actually gained across the step it
   * landed in, with gravity's share taken out. The old derivation read the
   * bounce at two thirds and the tilted rod at nearly three times this.
   */
  it("matches the impulse the solver applied", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <MeasuredSphere name="drop" x={0} />
        <MeasuredSphere name="bounce" x={5} restitution={0.5} />
        <MeasuredRod name="tilted" x={10} tilt={30} />
      </>,
    );

    await step(renderer, 90);

    for (const name of ["drop", "bounce", "tilted"]) {
      const reported = firstLanding(name);
      const measured = firstHit(name);

      expect(reported.impulse).toBeGreaterThan(1);
      expect(reported.impulse / measured.normal).toBeGreaterThan(0.98);
      expect(reported.impulse / measured.normal).toBeLessThan(1.02);
      expect(reported.frictionImpulse).toBeCloseTo(measured.tangent, 1);
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("tells a scrape from a drop", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <MeasuredRod name="straight" x={0} />
        <MeasuredRod name="scrape" x={10} slide={6} />
      </>,
    );

    await step(renderer, 90);

    const straight = firstLanding("straight");
    const scrape = firstLanding("scrape");

    expect(straight.frictionImpulse).toBeLessThan(0.01);
    expect(scrape.frictionImpulse).toBeGreaterThan(0.25 * scrape.impulse);
    expect(scrape.frictionImpulse).toBeCloseTo(firstHit("scrape").tangent, 1);

    await unmount(renderer);
    expectNoAsserts();
  });
});

const GRAVITY = 9.81;

interface Hit {
  normal: number;
  tangent: number;
}

const hits: Record<string, Hit[]> = {};

/** The first step in which the floor pushed back harder than gravity pulled. */
const firstHit = (name: string) => {
  const found = hits[name]?.find((hit) => hit.normal > 0.5);
  if (!found) throw new Error(`${name} never landed`);
  return found;
};

/**
 * Mass 1 and no damping, so the change in velocity across a step, less
 * gravity's share, is the impulse the solver applied.
 */
const useMomentumChange = (
  name: string,
  api: BodyApi<Jolt.Shape> | undefined,
  slide: number,
) => {
  const before = useRef<[number, number]>([0, 0]);
  const pushed = useRef(false);

  useBeforePhysicsStep(() => {
    if (!api) return;
    if (slide !== 0 && !pushed.current) {
      api.setLinearVelocity([slide, 0, 0]);
      pushed.current = true;
    }
    const velocity = api.body.GetLinearVelocity();
    before.current = [velocity.GetX(), velocity.GetY()];
  });

  useAfterPhysicsStep((delta) => {
    if (!api) return;
    const velocity = api.body.GetLinearVelocity();
    (hits[name] ??= []).push({
      normal: velocity.GetY() - before.current[1] + GRAVITY * delta,
      tangent: Math.abs(velocity.GetX() - before.current[0]),
    });
  });
};

interface MeasuredProps {
  name: string;
  x: number;
  restitution?: number;
  slide?: number;
}

const measuredBody = (restitution: number) =>
  ({
    motionType: "dynamic",
    mass: 1,
    linearDamping: 0,
    material: { restitution, friction: 0.5 },
  }) as const;

const useMeasured = (name: string, api: BodyApi<Jolt.Shape> | undefined, slide: number) => {
  useMomentumChange(name, api, slide);
  useBodyContacts(
    api?.body,
    { onEnter: (contact) => record(name, contact) },
    { contactForce: true },
  );
};

const MeasuredSphere = ({
  name,
  x,
  restitution = 0,
  slide = 0,
}: MeasuredProps) => {
  const [, api] = useSphere({
    ...measuredBody(restitution),
    position: [x, 2.5, 0],
    radius: 0.5,
  });
  useMeasured(name, api, slide);
  return null;
};

/** A 3 m rod, tilted about z so that one end lands first. */
const MeasuredRod = ({
  name,
  x,
  restitution = 0,
  slide = 0,
  tilt = 0,
}: MeasuredProps & { tilt?: number }) => {
  const half = (tilt * Math.PI) / 360;
  const [, api] = useBox({
    ...measuredBody(restitution),
    position: [x, 2.5, 0],
    rotation: [0, 0, Math.sin(half), Math.cos(half)],
    size: [3, 0.2, 0.2],
  });
  useMeasured(name, api, slide);
  return null;
};

const Slab = () => {
  const [, api] = useBox({
    position: [0, -0.5, 0],
    size: [20, 1, 20],
    motionType: "static",
  });

  useBodyContacts(
    api?.body,
    { onStay: (contact) => record("stayOnly", contact) },
    { contactForce: true },
  );

  return null;
};

const EnteringOnly = () => {
  const [, api] = useSphere({
    position: [0, 4, 0],
    radius: 0.5,
    motionType: "dynamic",
    mass: 3,
    allowSleeping: false,
  });

  useBodyContacts(
    api?.body,
    { onEnter: (contact) => record("enterOnly", contact) },
    { contactForce: true },
  );

  return null;
};

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
