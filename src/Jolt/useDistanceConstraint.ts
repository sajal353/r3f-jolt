import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  applySpring,
  resolvePair,
  resolveSpace,
} from "./internal/constraintSettings";
import type {
  ConstraintSpace,
  SpringOptions,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseDistanceConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
  /**
   * Both default to the distance between the anchor points at creation, which
   * makes the joint a rigid rod. Give them different values for a rope that is
   * slack until it runs out.
   */
  minDistance?: number;
  maxDistance?: number;
  limitsSpring?: SpringOptions;
}

export interface DistanceConstraintExtras {
  setDistance: (min: number, max: number) => void;
  getMinDistance: () => number;
  getMaxDistance: () => number;
}

export type DistanceConstraintApi = ConstraintApi<Jolt.DistanceConstraint> &
  DistanceConstraintExtras;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseDistanceConstraintOptions,
) => {
  const settings = new jolt.DistanceConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);
  if (options.minDistance !== undefined) {
    settings.mMinDistance = options.minDistance;
  }
  if (options.maxDistance !== undefined) {
    settings.mMaxDistance = options.maxDistance;
  }

  applySpring(
    jolt,
    (spring) => (settings.mLimitsSpringSettings = spring),
    options.limitsSpring,
  );

  return settings;
};

const castDistance = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.DistanceConstraint);

const createDistanceApi = ({
  constraint,
  usable,
  activate,
}: ConstraintApiContext<Jolt.DistanceConstraint>): DistanceConstraintExtras => {
  const setDistance = (min: number, max: number) => {
    if (!usable()) return;
    constraint.SetDistance(min, max);
    activate();
  };

  const getMinDistance = () => (usable() ? constraint.GetMinDistance() : 0);

  const getMaxDistance = () => (usable() ? constraint.GetMaxDistance() : 0);

  return { setDistance, getMinDistance, getMaxDistance };
};

/** Keeps two anchor points within a distance range — ropes, springs and rods. */
export const useDistanceConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseDistanceConstraintOptions = {},
) =>
  useConstraint<Jolt.DistanceConstraint, DistanceConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castDistance,
      api: createDistanceApi,
    },
  );
