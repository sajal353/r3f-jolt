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

export interface UseFixedConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  /**
   * Welds the bodies where they already are, ignoring the anchor points. On by
   * default, because a fixed joint almost always means "keep these exactly as I
   * placed them".
   */
  autoDetectPoint?: boolean;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
  axisX?: Vec3Tuple;
  axisX1?: Vec3Tuple;
  axisX2?: Vec3Tuple;
  axisY?: Vec3Tuple;
  axisY1?: Vec3Tuple;
  axisY2?: Vec3Tuple;
}

/**
 * Jolt binds no `FixedConstraint` class, only its settings, so this is the base
 * two-body constraint. Nothing is lost — a welded joint has no runtime controls.
 */
export type FixedConstraintApi = ConstraintApi<Jolt.TwoBodyConstraint>;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseFixedConstraintOptions,
) => {
  const settings = new jolt.FixedConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );
  const [axisX1, axisX2] = resolvePair(
    options.axisX,
    options.axisX1,
    options.axisX2,
  );
  const [axisY1, axisY2] = resolvePair(
    options.axisY,
    options.axisY1,
    options.axisY2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);
  settings.mAutoDetectPoint = options.autoDetectPoint ?? true;

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);
  if (axisX1) settings.mAxisX1 = temps.vec3(axisX1);
  if (axisX2) settings.mAxisX2 = temps.vec3(axisX2);
  if (axisY1) settings.mAxisY1 = temps.vec3(axisY1);
  if (axisY2) settings.mAxisY2 = temps.vec3(axisY2);

  return settings;
};

const castFixed = (constraint: Jolt.TwoBodyConstraint) => constraint;

/** Welds two bodies together, removing all six degrees of freedom between them. */
export const useFixedConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseFixedConstraintOptions = {},
) =>
  useConstraint<Jolt.TwoBodyConstraint>(body1, body2, options, {
    settings: (jolt, temps) => buildSettings(jolt, temps, options),
    cast: castFixed,
  });
