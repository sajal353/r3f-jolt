import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSphere } from "@/Jolt/useSphere";
import { usePlane } from "@/Jolt/usePlane";
import { useGroupFilterTable } from "@/Jolt/useGroupFilterTable";
import { interactionGroups } from "@/Jolt/internal/interactionGroups";
import type { GroupFilterTableApi } from "@/Jolt/useGroupFilterTable";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  renderPhysics,
  step,
  unmount,
} from "./harness";

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

beforeEach(() => {
  for (const key of Object.keys(published)) delete published[key];
});

const Ground = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 40 });
  return null;
};

const heightOf = (name: string) =>
  taken<BodyApi<never>>(name).body.GetPosition().GetY();

/**
 * A ball dropped onto another ball. With nothing filtering them it comes to
 * rest stacked, a diameter up; filtered, it falls straight through to the
 * floor and both sit at the same height.
 */
const Pair = ({
  table,
  lowerSubGroup,
  upperSubGroup,
  lowerGroup = 0,
  upperGroup = 0,
  x = 0,
  prefix,
}: {
  table: GroupFilterTableApi;
  lowerSubGroup: number;
  upperSubGroup: number;
  lowerGroup?: number;
  upperGroup?: number;
  x?: number;
  prefix: string;
}) => {
  const shared = {
    radius: 0.5,
    motionType: "dynamic" as const,
    mass: 1,
    allowSleeping: false,
  };

  const [, lower] = useSphere({
    ...shared,
    position: [x, 0.5, 0] as Vec3Tuple,
    collisionGroup: {
      filter: table.filter,
      groupID: lowerGroup,
      subGroupID: lowerSubGroup,
    },
  });

  const [, upper] = useSphere({
    ...shared,
    position: [x, 4, 0] as Vec3Tuple,
    collisionGroup: {
      filter: table.filter,
      groupID: upperGroup,
      subGroupID: upperSubGroup,
    },
  });

  usePublished(`${prefix}Lower`, lower);
  usePublished(`${prefix}Upper`, upper);

  return null;
};

/**
 * The table is undefined on the owner's first render, and a body reads its
 * filter at creation — so the bodies live in a child rendered only once it
 * exists. This is the pattern the README documents.
 */
const FilteredScene = ({
  children,
}: {
  children: (table: GroupFilterTableApi) => React.ReactNode;
}) => {
  const table = useGroupFilterTable(4, (built) => {
    // Sub-groups 1 and 2 ignore each other; 1 and 3 do not.
    built.disableCollision(1, 2);
  });

  usePublished("table", table);

  return table ? <>{children(table)}</> : null;
};

describe("collision groups", () => {
  it("lets two disabled sub-groups pass through each other", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <FilteredScene>
          {(table) => (
            <>
              <Pair
                table={table}
                lowerSubGroup={1}
                upperSubGroup={2}
                x={0}
                prefix="through"
              />
              <Pair
                table={table}
                lowerSubGroup={1}
                upperSubGroup={3}
                x={10}
                prefix="stacked"
              />
            </>
          )}
        </FilteredScene>
      </>,
    );

    await step(renderer, 180);

    // Disabled: both end up on the floor, at the same height.
    expect(heightOf("throughUpper")).toBeCloseTo(heightOf("throughLower"), 1);
    expect(heightOf("throughUpper")).toBeLessThan(1);

    // Enabled: the upper one rests on the lower, a diameter above it.
    expect(heightOf("stackedUpper") - heightOf("stackedLower")).toBeGreaterThan(
      0.8,
    );

    await unmount(renderer);
    expectNoAsserts();
  });

  /**
   * The table is consulted only within one group. Two bodies whose sub-groups
   * are disabled still collide when they are in different groups, which is what
   * keeps a filter local to the ragdoll that owns it.
   */
  it("collides across different groups whatever the table says", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <FilteredScene>
          {(table) => (
            <Pair
              table={table}
              lowerSubGroup={1}
              upperSubGroup={2}
              lowerGroup={0}
              upperGroup={1}
              x={0}
              prefix="cross"
            />
          )}
        </FilteredScene>
      </>,
    );

    await step(renderer, 180);

    // Sub-groups 1 and 2 are disabled, but the groups differ, so they stack.
    expect(heightOf("crossUpper") - heightOf("crossLower")).toBeGreaterThan(0.8);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("changes the outcome through setCollisionGroup at runtime", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <FilteredScene>
          {(table) => (
            <Pair
              table={table}
              lowerSubGroup={1}
              upperSubGroup={3}
              x={0}
              prefix="late"
            />
          )}
        </FilteredScene>
      </>,
    );

    const table = taken<GroupFilterTableApi>("table");
    const upper = taken<BodyApi<never>>("lateUpper");

    // Sub-group 3 collides with 1, so move it into 2, which does not.
    upper.setCollisionGroup({
      filter: table.filter,
      groupID: 0,
      subGroupID: 2,
    });

    await step(renderer, 180);

    expect(heightOf("lateUpper")).toBeCloseTo(heightOf("lateLower"), 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("survives a StrictMode double mount with the filter still live", async () => {
    const renderer = await renderPhysics(
      <>
        <Ground />
        <FilteredScene>
          {(table) => (
            <Pair
              table={table}
              lowerSubGroup={1}
              upperSubGroup={2}
              x={0}
              prefix="strict"
            />
          )}
        </FilteredScene>
      </>,
      { strict: true },
    );

    await step(renderer, 180);

    expect(heightOf("strictUpper")).toBeCloseTo(heightOf("strictLower"), 1);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reads back the table it was configured with", async () => {
    const renderer = await renderPhysics(<FilteredScene>{() => null}</FilteredScene>);

    const table = taken<GroupFilterTableApi>("table");
    expect(table.isCollisionEnabled(1, 2)).toBe(false);
    expect(table.isCollisionEnabled(1, 3)).toBe(true);

    table.enableCollision(1, 2);
    expect(table.isCollisionEnabled(1, 2)).toBe(true);

    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("interactionGroups", () => {
  it("packs exactly as Jolt does", async () => {
    const renderer = await renderPhysics(<Ground />);
    const { objectLayer } = getApi();

    const cases: [number, number][] = [
      [0, 0],
      [1, 2],
      [5, 9],
      [0xffff, 0],
      [0, 0xffff],
      [0xffff, 0xffff],
    ];

    for (const [group, mask] of cases) {
      expect(interactionGroups(group, mask)).toBe(objectLayer(group, mask));
    }

    await unmount(renderer);
    expectNoAsserts();
  });

  it("refuses a value that would lose its high half", async () => {
    expect(() => interactionGroups(0x10000, 0)).toThrow(/16-bit/);
    expect(() => interactionGroups(0, 0x10000)).toThrow(/16-bit/);
    expect(() => interactionGroups(-1, 0)).toThrow(/16-bit/);
    expect(() => interactionGroups(1.5, 0)).toThrow(/16-bit/);
  });
});
