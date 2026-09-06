import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  applyLimits,
  applyMotor,
  applySpring,
  resolveMotorState,
  resolvePair,
  resolveSpace,
} from "./internal/constraintSettings";
import type {
  AngularMotorOptions,
  ConstraintSpace,
  LimitOptions,
  MotorState,
  SpringOptions,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseHingeConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
  /** The axis the joint turns about. */
  hingeAxis?: Vec3Tuple;
  hingeAxis1?: Vec3Tuple;
  hingeAxis2?: Vec3Tuple;
  /** Perpendicular to the hinge axis; angle zero is where these two line up. */
  normalAxis?: Vec3Tuple;
  normalAxis1?: Vec3Tuple;
  normalAxis2?: Vec3Tuple;
  /** Radians, relative to the normal axes. Unlimited when left out. */
  limits?: LimitOptions;
  limitsSpring?: SpringOptions;
  maxFrictionTorque?: number;
  motor?: AngularMotorOptions;
}

export interface HingeConstraintExtras {
  setMotorState: (state: MotorState) => void;
  setTargetAngle: (radians: number) => void;
  setTargetAngularVelocity: (radiansPerSecond: number) => void;
  getCurrentAngle: () => number;
  setLimits: (limits: LimitOptions) => void;
  setMaxFrictionTorque: (torque: number) => void;
}

export type HingeConstraintApi = ConstraintApi<Jolt.HingeConstraint> &
  HingeConstraintExtras;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseHingeConstraintOptions,
) => {
  const settings = new jolt.HingeConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );
  const [hingeAxis1, hingeAxis2] = resolvePair(
    options.hingeAxis,
    options.hingeAxis1,
    options.hingeAxis2,
  );
  const [normalAxis1, normalAxis2] = resolvePair(
    options.normalAxis,
    options.normalAxis1,
    options.normalAxis2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);
  if (hingeAxis1) settings.mHingeAxis1 = temps.vec3(hingeAxis1);
  if (hingeAxis2) settings.mHingeAxis2 = temps.vec3(hingeAxis2);
  if (normalAxis1) settings.mNormalAxis1 = temps.vec3(normalAxis1);
  if (normalAxis2) settings.mNormalAxis2 = temps.vec3(normalAxis2);
  if (options.maxFrictionTorque !== undefined) {
    settings.mMaxFrictionTorque = options.maxFrictionTorque;
  }

  applyLimits(settings, options.limits);
  applySpring(
    jolt,
    (spring) => (settings.mLimitsSpringSettings = spring),
    options.limitsSpring,
  );
  applyMotor(jolt, (motor) => (settings.mMotorSettings = motor), options.motor);

  return settings;
};

const castHinge = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.HingeConstraint);

const createHingeApi = (
  {
    constraint,
    usable,
    activate,
    jolt,
  }: ConstraintApiContext<Jolt.HingeConstraint>,
  motor: AngularMotorOptions | undefined,
): HingeConstraintExtras => {
  const setMotorState = (state: MotorState) => {
    if (!usable()) return;
    constraint.SetMotorState(resolveMotorState(jolt, state));
    activate();
  };

  const setTargetAngle = (radians: number) => {
    if (!usable()) return;
    constraint.SetTargetAngle(radians);
    activate();
  };

  const setTargetAngularVelocity = (radiansPerSecond: number) => {
    if (!usable()) return;
    constraint.SetTargetAngularVelocity(radiansPerSecond);
    activate();
  };

  const getCurrentAngle = () => (usable() ? constraint.GetCurrentAngle() : 0);

  const setLimits = (limits: LimitOptions) => {
    if (!usable()) return;
    constraint.SetLimits(limits.min, limits.max);
    activate();
  };

  const setMaxFrictionTorque = (torque: number) => {
    if (!usable()) return;
    constraint.SetMaxFrictionTorque(torque);
    activate();
  };

  if (motor?.targetAngle !== undefined) setTargetAngle(motor.targetAngle);
  if (motor?.targetAngularVelocity !== undefined) {
    setTargetAngularVelocity(motor.targetAngularVelocity);
  }
  if (motor?.state) setMotorState(motor.state);

  return {
    setMotorState,
    setTargetAngle,
    setTargetAngularVelocity,
    getCurrentAngle,
    setLimits,
    setMaxFrictionTorque,
  };
};

/**
 * One rotational degree of freedom about a shared axis — doors, wheels, levers.
 * Add a `motor` to drive it, or `limits` to stop it short.
 */
export const useHingeConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseHingeConstraintOptions = {},
) =>
  useConstraint<Jolt.HingeConstraint, HingeConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castHinge,
      api: (context) => createHingeApi(context, options.motor),
    },
  );
