import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import { resolvePair, resolveSpace } from "./internal/constraintSettings";
import type { ConstraintSpace } from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UsePointConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
}

export type PointConstraintApi = ConstraintApi<Jolt.PointConstraint>;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UsePointConstraintOptions,
) => {
  const settings = new jolt.PointConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);

  return settings;
};

const castPoint = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.PointConstraint);

/**
 * A ball joint: the two anchor points are held together and every rotation is
 * left free. The building block for chains and pendulums.
 */
export const usePointConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UsePointConstraintOptions = {},
) =>
  useConstraint<Jolt.PointConstraint>(body1, body2, options, {
    settings: (jolt, temps) => buildSettings(jolt, temps, options),
    cast: castPoint,
  });
