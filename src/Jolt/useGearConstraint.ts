import { useEffect, useMemo, useState } from "react";
import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import { readGearLoad } from "./internal/constraintLoad";
import {
  resolvePair,
  resolveSpace,
  type ConstraintSpace,
} from "./internal/constraintSettings";
import type { HingeConstraintApi } from "./useHingeConstraint";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseGearConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  hingeAxis?: Vec3Tuple;
  hingeAxis1?: Vec3Tuple;
  hingeAxis2?: Vec3Tuple;
  /** Teeth on body 1 and body 2. Body 1 turns `teeth2 / teeth1` per turn of body 2, the other way. */
  teeth?: [number, number];
  /** In place of `teeth`: body 1's rotation is `-ratio` times body 2's. */
  ratio?: number;
  /**
   * The hinge holding each gear, each turning the same way as `hingeAxis` and
   * starting at its zero angle. The gear joint only ties their speeds without
   * these, so the two slowly slip out of step; with them it corrects the angle.
   * Ignored, with a warning, when neither gear turns a whole number of times per
   * turn of the other, which that correction cannot handle.
   */
  hinges?: readonly [
    HingeConstraintApi | undefined,
    HingeConstraintApi | undefined,
  ];
}

export type GearConstraintApi = ConstraintApi<Jolt.GearConstraint>;

const NEARLY_WHOLE = 1e-6;

const isWhole = (value: number) =>
  Math.abs(value - Math.round(value)) < NEARLY_WHOLE;

/**
 * Jolt corrects drift from `angle1 + ratio * angle2`, modulo a full turn, using
 * hinge angles that wrap at ±π. Each wrap of `angle2` moves that sum by
 * `ratio` full turns, which is invisible only when `ratio` is whole: at 0.5
 * Jolt sees a half-turn error every time the wheel comes round, and snaps the
 * wheels to fix it. So a ratio under 1 is given to Jolt the other way round.
 */
const planCorrection = (options: UseGearConstraintOptions) => {
  const { teeth, ratio = 1, hinges } = options;
  const value = teeth ? teeth[1] / teeth[0] : ratio;

  if (!hinges || isWhole(value)) return { swapped: false, correct: !!hinges };
  if (isWhole(1 / value)) return { swapped: true, correct: true };
  return { swapped: false, correct: false };
};

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseGearConstraintOptions,
  swapped: boolean,
) => {
  const settings = new jolt.GearConstraintSettings();
  const [first, second] = resolvePair(
    options.hingeAxis,
    options.hingeAxis1,
    options.hingeAxis2,
  );
  const [axis1, axis2] = swapped ? [second, first] : [first, second];

  settings.mSpace = resolveSpace(jolt, options.space);
  if (axis1) settings.mHingeAxis1 = temps.vec3(axis1);
  if (axis2) settings.mHingeAxis2 = temps.vec3(axis2);

  if (options.teeth) {
    const [teeth1, teeth2] = options.teeth;
    if (swapped) settings.SetRatio(teeth2, teeth1);
    else settings.SetRatio(teeth1, teeth2);
  } else if (options.ratio !== undefined) {
    settings.mRatio = swapped ? Math.round(1 / options.ratio) : options.ratio;
  }

  return settings;
};

const castGear = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.GearConstraint);

/**
 * Ties the turning of two bodies that each sit on a hinge of their own, in a
 * fixed ratio. It holds no position: the hinges do that.
 */
export const useGearConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseGearConstraintOptions,
) => {
  const [{ swapped, correct }] = useState(() => planCorrection(options));

  const [joint] = useConstraint<Jolt.GearConstraint>(
    swapped ? body2 : body1,
    swapped ? body1 : body2,
    options,
    {
      hook: "useGearConstraint",
      settings: (jolt, temps) => buildSettings(jolt, temps, options, swapped),
      cast: castGear,
      load: readGearLoad,
    },
  );

  const gear = useMemo(
    () =>
      swapped && joint
        ? { ...joint, body1: joint.body2, body2: joint.body1 }
        : joint,
    [joint, swapped],
  );

  const hinge1 = options.hinges?.[0];
  const hinge2 = options.hinges?.[1];
  const ignoresHinges = !!options.hinges && !correct;

  useEffect(() => {
    if (!ignoresHinges) return;

    console.warn(
      "[r3f-jolt] useGearConstraint: hinges ignored. Neither gear turns a whole " +
        "number of times per turn of the other, and Jolt's drift correction " +
        "would snap the wheels each time one comes round. Speeds stay tied.",
    );
  }, [ignoresHinges]);

  useEffect(() => {
    if (!joint || !correct || !hinge1 || !hinge2) return;

    joint.constraint.SetConstraints(
      swapped ? hinge2.constraint : hinge1.constraint,
      swapped ? hinge1.constraint : hinge2.constraint,
    );
  }, [joint, correct, swapped, hinge1, hinge2]);

  return [gear] as [GearConstraintApi | undefined];
};
