import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import { resolvePair, resolveSpace } from "./internal/constraintSettings";
import type { ConstraintSpace } from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseConeConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
  twistAxis?: Vec3Tuple;
  twistAxis1?: Vec3Tuple;
  twistAxis2?: Vec3Tuple;
  /** Radians. The twist axes may separate by at most this much. */
  halfConeAngle?: number;
}

export interface ConeConstraintExtras {
  setHalfConeAngle: (radians: number) => void;
  getCosHalfConeAngle: () => number;
}

export type ConeConstraintApi = ConstraintApi<Jolt.ConeConstraint> &
  ConeConstraintExtras;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseConeConstraintOptions,
) => {
  const settings = new jolt.ConeConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );
  const [twistAxis1, twistAxis2] = resolvePair(
    options.twistAxis,
    options.twistAxis1,
    options.twistAxis2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);
  if (twistAxis1) settings.mTwistAxis1 = temps.vec3(twistAxis1);
  if (twistAxis2) settings.mTwistAxis2 = temps.vec3(twistAxis2);
  if (options.halfConeAngle !== undefined) {
    settings.mHalfConeAngle = options.halfConeAngle;
  }

  return settings;
};

const castCone = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.ConeConstraint);

const createConeApi = ({
  constraint,
  usable,
  activate,
}: ConstraintApiContext<Jolt.ConeConstraint>): ConeConstraintExtras => {
  const setHalfConeAngle = (radians: number) => {
    if (!usable()) return;
    constraint.SetHalfConeAngle(radians);
    activate();
  };

  const getCosHalfConeAngle = () =>
    usable() ? constraint.GetCosHalfConeAngle() : 0;

  return { setHalfConeAngle, getCosHalfConeAngle };
};

/**
 * Holds two points together and limits how far the twist axes may splay apart,
 * leaving twist about the axis free. For finer control over the twist itself,
 * reach for `useSwingTwistConstraint`.
 */
export const useConeConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseConeConstraintOptions = {},
) =>
  useConstraint<Jolt.ConeConstraint, ConeConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castCone,
      api: createConeApi,
    },
  );
