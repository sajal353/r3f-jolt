import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useContactListener } from "@/Jolt/useContactListener";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ContactInfo } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

const Ground = () => {
  useBox({ size: [20, 1, 20], position: [0, -0.5, 0], motionType: "static" });
  return null;
};

const Falling = ({
  userData,
  onReady,
}: {
  userData?: number;
  onReady?: (api: BodyApi<Jolt.BoxShape>) => void;
}) => {
  const [, api] = useBox({
    size: [1, 1, 1],
    position: [0, 2, 0],
    motionType: "dynamic",
    mass: 10,
    userData,
  });

  if (api && onReady) onReady(api);
  return null;
};

describe("contact events", () => {
  it("delivers raw listener callbacks with wrapped arguments", async () => {
    const added = vi.fn();
    let readUserData = -1;

    const Listener = () => {
      useContactListener({
        onContactAdded: (body1, body2) => {
          added();
          readUserData = Math.max(body1.GetUserData(), body2.GetUserData());
        },
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Falling userData={7} />
        <Listener />
      </>,
    );

    await step(renderer, 120);

    expect(added).toHaveBeenCalled();
    expect(readUserData).toBe(7);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("multiplexes several listeners onto Jolt's single contact listener", async () => {
    const first = vi.fn();
    const second = vi.fn();

    const Listener = ({ spy }: { spy: () => void }) => {
      useContactListener({ onContactAdded: () => spy() });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Falling />
        <Listener spy={first} />
        <Listener spy={second} />
      </>,
    );

    await step(renderer, 120);

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("suppresses contacts when a validate handler returns false", async () => {
    const added = vi.fn();

    const Rejecting = () => {
      useContactListener({
        onContactValidate: () => false,
        onContactAdded: () => added(),
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Falling />
        <Rejecting />
      </>,
    );

    await step(renderer, 150);

    expect(added).not.toHaveBeenCalled();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("fires useBodyContacts only for its own body and allows setState", async () => {
    const enters: ContactInfo[] = [];

    const Reporter = () => {
      const [, api] = useBox({
        size: [1, 1, 1],
        position: [0, 2, 0],
        motionType: "dynamic",
        mass: 10,
        userData: 3,
      });
      const [hits, setHits] = useState(0);

      useBodyContacts(api?.body, {
        onEnter: (contact) => {
          enters.push({ ...contact, point: contact.point.clone() });
          setHits((value) => value + 1);
        },
      });

      return hits > 100 ? null : null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Reporter />
      </>,
    );

    await step(renderer, 150);

    expect(enters.length).toBeGreaterThan(0);
    expect(enters[0].bodyID).not.toBe(0);
    expect(Number.isFinite(enters[0].point.y)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("keeps working after one of two subscribers unmounts", async () => {
    const survivor = vi.fn();
    const removed = vi.fn();

    const Listener = ({ spy }: { spy: () => void }) => {
      useContactListener({ onContactAdded: () => spy() });
      return null;
    };

    const Scene = ({ showSecond }: { showSecond: boolean }) => (
      <>
        <Ground />
        <Falling />
        <Listener spy={survivor} />
        {showSecond ? <Listener spy={removed} /> : null}
      </>
    );

    const renderer = await renderPhysics(<Scene showSecond />);
    await step(renderer, 120);

    expect(survivor).toHaveBeenCalled();
    expect(removed).toHaveBeenCalled();

    survivor.mockClear();
    removed.mockClear();

    await unmount(renderer);
    expectNoAsserts();
  });

  it("uninstalls the Jolt listener when the last subscriber goes away", async () => {
    const Listener = () => {
      useContactListener({ onContactAdded: () => {} });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Ground />
        <Listener />
      </>,
    );

    const { physicsSystem, Jolt } = getApi();

    expect(Jolt.getPointer(physicsSystem.GetContactListener())).not.toBe(0);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });
});
