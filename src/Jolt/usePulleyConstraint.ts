import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  resolvePair,
  resolveSpace,
  type ConstraintSpace,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UsePulleyConstraintOptions extends ConstraintOptions {
  /** Applies to the body points. The fixed points are always world space. */
  space?: ConstraintSpace;
  bodyPoint?: Vec3Tuple;
  bodyPoint1?: Vec3Tuple;
  bodyPoint2?: Vec3Tuple;
  /** Where the rope turns on its way to body 1. */
  fixedPoint1: Vec3Tuple;
  /** Where the rope turns on its way to body 2. */
  fixedPoint2: Vec3Tuple;
  /** The rope's length is `length1 + ratio * length2`: 2 gives body 2 half the travel. */
  ratio?: number;
  /** Below this the rope pushes back. 0 by default, so it goes slack. */
  minLength?: number;
  /** The rope's full length. Defaults to what it measures at mount. */
  maxLength?: number;
}

export interface PulleyConstraintExtras {
  /** Winches the rope: `max` shorter than the rope now pulls it in. */
  setLength: (min: number, max: number) => void;
  /** `length1 + ratio * length2` as it stands. */
  getCurrentLength: () => number;
  getMinLength: () => number;
  getMaxLength: () => number;
}

export type PulleyConstraintApi = ConstraintApi<Jolt.PulleyConstraint> &
  PulleyConstraintExtras;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UsePulleyConstraintOptions,
) => {
  const settings = new jolt.PulleyConstraintSettings();
  const [point1, point2] = resolvePair(
    options.bodyPoint,
    options.bodyPoint1,
    options.bodyPoint2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);
  if (point1) settings.mBodyPoint1 = temps.rvec3(point1);
  if (point2) settings.mBodyPoint2 = temps.rvec3(point2);
  settings.mFixedPoint1 = temps.rvec3(options.fixedPoint1);
  settings.mFixedPoint2 = temps.rvec3(options.fixedPoint2);

  if (options.ratio !== undefined) settings.mRatio = options.ratio;
  if (options.minLength !== undefined) settings.mMinLength = options.minLength;
  if (options.maxLength !== undefined) settings.mMaxLength = options.maxLength;

  return settings;
};

const castPulley = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.PulleyConstraint);

const createPulleyApi = ({
  constraint,
  usable,
  activate,
}: ConstraintApiContext<Jolt.PulleyConstraint>): PulleyConstraintExtras => ({
  setLength: (min, max) => {
    if (!usable()) return;
    constraint.SetLength(min, max);
    activate();
  },
  getCurrentLength: () => (usable() ? constraint.GetCurrentLength() : 0),
  getMinLength: () => (usable() ? constraint.GetMinLength() : 0),
  getMaxLength: () => (usable() ? constraint.GetMaxLength() : 0),
});

/**
 * Two bodies on one rope over two fixed points: as one drops, the other rises.
 * A rope only pulls, so this limits length and leaves everything else free.
 */
export const usePulleyConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UsePulleyConstraintOptions,
) =>
  useConstraint<Jolt.PulleyConstraint, PulleyConstraintExtras>(
    body1,
    body2,
    options,
    {
      hook: "usePulleyConstraint",
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castPulley,
      api: createPulleyApi,
    },
  );
