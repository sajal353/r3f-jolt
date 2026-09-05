import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { usePlane } from "@/Jolt/usePlane";
import { useSensor } from "@/Jolt/useSensor";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import { expectNoAsserts, renderPhysics, step, unmount } from "./harness";

const published: Record<string, unknown> = {};

const usePublished = <T,>(name: string, value: T | undefined) => {
  useEffect(() => {
    if (value) published[name] = value;
  }, [name, value]);
};

const taken = <T,>(name: string) => {
  const value = published[name];
  if (!value) throw new Error(`${name} was never published`);
  return value as T;
};

const events: string[] = [];

beforeEach(() => {
  for (const key of Object.keys(published)) delete published[key];
  events.length = 0;
});

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 40 });
  return null;
};

const Volume = ({
  position = [0, 2, 0] as Vec3Tuple,
  keepSleeping,
  size = [3, 2, 3] as Vec3Tuple,
}: {
  position?: Vec3Tuple;
  keepSleeping?: boolean;
  size?: Vec3Tuple;
}) => {
  const [, api] = useBox({
    position,
    size,
    motionType: "static",
    sensor: true,
  });

  const [inside] = useSensor(
    api?.body,
    {
      onIntersectionEnter: (contact) => events.push(`enter:${contact.bodyID}`),
      onIntersectionExit: (contact) => events.push(`exit:${contact.bodyID}`),
    },
    { keepSleeping },
  );

  usePublished("inside", inside);
  usePublished("volume", api);

  return null;
};

const Ball = ({
  name,
  position,
  allowSleeping = true,
}: {
  name: string;
  position: Vec3Tuple;
  allowSleeping?: boolean;
}) => {
  const [, api] = useSphere({
    position,
    radius: 0.4,
    motionType: "dynamic",
    mass: 1,
    allowSleeping,
    gravityFactor: 0,
  });

  usePublished(name, api);
  return null;
};

const idOf = (api: BodyApi<never>) =>
  api.body.GetID().GetIndexAndSequenceNumber();

describe("useSensor", () => {
  it("lists what is inside, and drops it when it leaves", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="ball" position={[0, 2, 0]} allowSleeping={false} />
      </>,
    );

    await step(renderer, 5);

    const ball = taken<BodyApi<never>>("ball");
    expect(taken<readonly number[]>("inside")).toEqual([idOf(ball)]);
    expect(events).toContain(`enter:${idOf(ball)}`);

    ball.setPositionAndRotation([20, 2, 0], [0, 0, 0, 1], true);
    await step(renderer, 5);

    expect(taken<readonly number[]>("inside")).toEqual([]);
    expect(events).toContain(`exit:${idOf(ball)}`);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds two bodies at once", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="left" position={[-1, 2, 0]} allowSleeping={false} />
        <Ball name="right" position={[1, 2, 0]} allowSleeping={false} />
      </>,
    );

    await step(renderer, 5);

    const left = taken<BodyApi<never>>("left");
    const right = taken<BodyApi<never>>("right");

    expect([...taken<readonly number[]>("inside")].sort()).toEqual(
      [idOf(left), idOf(right)].sort(),
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * The finding this option exists for: Jolt keeps a sensor contact only while
   * the other body is awake, so a body that settles inside fires an exit one
   * step after it falls asleep — without having moved at all.
   */
  it("keeps a body that falls asleep inside", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="sleeper" position={[0, 2, 0]} />
      </>,
    );

    await step(renderer, 5);
    const sleeper = taken<BodyApi<never>>("sleeper");
    expect(taken<readonly number[]>("inside")).toEqual([idOf(sleeper)]);

    sleeper.sleep();
    await step(renderer, 10);

    expect(sleeper.isSleeping()).toBe(true);
    expect(taken<readonly number[]>("inside")).toEqual([idOf(sleeper)]);
    expect(events).not.toContain(`exit:${idOf(sleeper)}`);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reports Jolt's own exit when keepSleeping is off", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume keepSleeping={false} />
        <Ball name="sleeper" position={[0, 2, 0]} />
      </>,
    );

    await step(renderer, 5);
    const sleeper = taken<BodyApi<never>>("sleeper");
    expect(taken<readonly number[]>("inside")).toEqual([idOf(sleeper)]);

    sleeper.sleep();
    await step(renderer, 10);

    expect(taken<readonly number[]>("inside")).toEqual([]);
    expect(events).toContain(`exit:${idOf(sleeper)}`);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("does not re-enter a body that merely woke up", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="sleeper" position={[0, 2, 0]} />
      </>,
    );

    await step(renderer, 5);
    const sleeper = taken<BodyApi<never>>("sleeper");
    const enters = () =>
      events.filter((event) => event === `enter:${idOf(sleeper)}`).length;

    expect(enters()).toBe(1);

    sleeper.sleep();
    await step(renderer, 10);
    sleeper.wake();
    await step(renderer, 10);

    expect(taken<readonly number[]>("inside")).toEqual([idOf(sleeper)]);
    expect(enters()).toBe(1);

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * A body killed while asleep inside gets no exit from Jolt at all — the
   * contact went away when it slept. The held event is the only one there is.
   */
  it("delivers the held exit when a sleeping body is destroyed", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="doomed" position={[0, 2, 0]} />
      </>,
    );

    await step(renderer, 5);
    const doomed = taken<BodyApi<never>>("doomed");
    const doomedID = idOf(doomed);

    doomed.sleep();
    await step(renderer, 10);
    expect(taken<readonly number[]>("inside")).toEqual([doomedID]);

    doomed.kill();
    await step(renderer, 5);

    expect(taken<readonly number[]>("inside")).toEqual([]);
    expect(events).toContain(`exit:${doomedID}`);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("shares a body with useBodyContacts", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Both />
        <Ball name="ball" position={[0, 2, 0]} allowSleeping={false} />
      </>,
    );

    await step(renderer, 5);

    expect(events).toContain("sensor");
    expect(events).toContain("contacts");

    await unmount(renderer);
    expectNoAsserts();
  });

  it("survives a StrictMode double mount", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <Volume />
        <Ball name="ball" position={[0, 2, 0]} allowSleeping={false} />
      </>,
      { strict: true },
    );

    await step(renderer, 5);

    const ball = taken<BodyApi<never>>("ball");
    expect(taken<readonly number[]>("inside")).toEqual([idOf(ball)]);

    await unmount(renderer);
    expectNoAsserts();
  });
});

const Both = () => {
  const [, api] = useBox({
    position: [0, 2, 0],
    size: [3, 2, 3],
    motionType: "static",
    sensor: true,
  });

  useSensor(api?.body, { onIntersectionEnter: () => events.push("sensor") });
  useBodyContacts(api?.body, { onEnter: () => events.push("contacts") });

  return null;
};
