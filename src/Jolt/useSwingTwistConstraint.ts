import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  applyMotor,
  resolveMotorState,
  resolvePair,
  resolveSpace,
} from "./internal/constraintSettings";
import type {
  ConstraintSpace,
  MotorLimits,
  MotorState,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Input, Vec3Tuple } from "./types";

export type SwingType = "cone" | "pyramid";

export interface UseSwingTwistConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  position?: Vec3Tuple;
  position1?: Vec3Tuple;
  position2?: Vec3Tuple;
  twistAxis?: Vec3Tuple;
  twistAxis1?: Vec3Tuple;
  twistAxis2?: Vec3Tuple;
  planeAxis?: Vec3Tuple;
  planeAxis1?: Vec3Tuple;
  planeAxis2?: Vec3Tuple;
  /** `cone` sweeps a circle, `pyramid` a rectangle. Cone by default. */
  swingType?: SwingType;
  /** Radians. Swing away from the twist axis, in the plane-axis direction. */
  normalHalfConeAngle?: number;
  /** Radians. Swing away from the twist axis, perpendicular to the plane axis. */
  planeHalfConeAngle?: number;
  twistMinAngle?: number;
  twistMaxAngle?: number;
  maxFrictionTorque?: number;
  swingMotor?: MotorLimits & { state?: MotorState };
  twistMotor?: MotorLimits & { state?: MotorState };
  /** Radians per second about the constraint's own axes. */
  targetAngularVelocity?: Vec3Tuple;
}

export interface SwingTwistConstraintExtras {
  setSwingMotorState: (state: MotorState) => void;
  setTwistMotorState: (state: MotorState) => void;
  setTargetAngularVelocity: (velocity: Vec3Input) => void;
  setNormalHalfConeAngle: (radians: number) => void;
  setPlaneHalfConeAngle: (radians: number) => void;
  setTwistLimits: (min: number, max: number) => void;
  setMaxFrictionTorque: (torque: number) => void;
}

export type SwingTwistConstraintApi = ConstraintApi<Jolt.SwingTwistConstraint> &
  SwingTwistConstraintExtras;

const resolveSwingType = (jolt: JoltModule, swingType: SwingType = "cone") =>
  swingType === "pyramid" ? jolt.ESwingType_Pyramid : jolt.ESwingType_Cone;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseSwingTwistConstraintOptions,
) => {
  const settings = new jolt.SwingTwistConstraintSettings();
  const [position1, position2] = resolvePair(
    options.position,
    options.position1,
    options.position2,
  );
  const [twistAxis1, twistAxis2] = resolvePair(
    options.twistAxis,
    options.twistAxis1,
    options.twistAxis2,
  );
  const [planeAxis1, planeAxis2] = resolvePair(
    options.planeAxis,
    options.planeAxis1,
    options.planeAxis2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);
  settings.mSwingType = resolveSwingType(jolt, options.swingType);

  if (position1) settings.mPosition1 = temps.rvec3(position1);
  if (position2) settings.mPosition2 = temps.rvec3(position2);
  if (twistAxis1) settings.mTwistAxis1 = temps.vec3(twistAxis1);
  if (twistAxis2) settings.mTwistAxis2 = temps.vec3(twistAxis2);
  if (planeAxis1) settings.mPlaneAxis1 = temps.vec3(planeAxis1);
  if (planeAxis2) settings.mPlaneAxis2 = temps.vec3(planeAxis2);

  if (options.normalHalfConeAngle !== undefined) {
    settings.mNormalHalfConeAngle = options.normalHalfConeAngle;
  }
  if (options.planeHalfConeAngle !== undefined) {
    settings.mPlaneHalfConeAngle = options.planeHalfConeAngle;
  }
  if (options.twistMinAngle !== undefined) {
    settings.mTwistMinAngle = options.twistMinAngle;
  }
  if (options.twistMaxAngle !== undefined) {
    settings.mTwistMaxAngle = options.twistMaxAngle;
  }
  if (options.maxFrictionTorque !== undefined) {
    settings.mMaxFrictionTorque = options.maxFrictionTorque;
  }

  applyMotor(
    jolt,
    (motor) => (settings.mSwingMotorSettings = motor),
    options.swingMotor,
  );
  applyMotor(
    jolt,
    (motor) => (settings.mTwistMotorSettings = motor),
    options.twistMotor,
  );

  return settings;
};

const castSwingTwist = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.SwingTwistConstraint);

const createSwingTwistApi = (
  {
    constraint,
    usable,
    activate,
    jolt,
    temps,
  }: ConstraintApiContext<Jolt.SwingTwistConstraint>,
  options: UseSwingTwistConstraintOptions,
): SwingTwistConstraintExtras => {
  const setSwingMotorState = (state: MotorState) => {
    if (!usable()) return;
    constraint.SetSwingMotorState(resolveMotorState(jolt, state));
    activate();
  };

  const setTwistMotorState = (state: MotorState) => {
    if (!usable()) return;
    constraint.SetTwistMotorState(resolveMotorState(jolt, state));
    activate();
  };

  const setTargetAngularVelocity = (velocity: Vec3Input) => {
    if (!usable()) return;
    constraint.SetTargetAngularVelocityCS(temps.vec3(velocity));
    activate();
  };

  const setNormalHalfConeAngle = (radians: number) => {
    if (!usable()) return;
    constraint.SetNormalHalfConeAngle(radians);
    activate();
  };

  const setPlaneHalfConeAngle = (radians: number) => {
    if (!usable()) return;
    constraint.SetPlaneHalfConeAngle(radians);
    activate();
  };

  const setTwistLimits = (min: number, max: number) => {
    if (!usable()) return;
    constraint.SetTwistMinAngle(min);
    constraint.SetTwistMaxAngle(max);
    activate();
  };

  const setMaxFrictionTorque = (torque: number) => {
    if (!usable()) return;
    constraint.SetMaxFrictionTorque(torque);
    activate();
  };

  if (options.targetAngularVelocity) {
    setTargetAngularVelocity(options.targetAngularVelocity);
  }
  if (options.swingMotor?.state) setSwingMotorState(options.swingMotor.state);
  if (options.twistMotor?.state) setTwistMotorState(options.twistMotor.state);

  return {
    setSwingMotorState,
    setTwistMotorState,
    setTargetAngularVelocity,
    setNormalHalfConeAngle,
    setPlaneHalfConeAngle,
    setTwistLimits,
    setMaxFrictionTorque,
  };
};

/**
 * A cone constraint that also bounds the twist, with separate motors for swing
 * and twist. This is the shoulder-and-hip joint of a ragdoll.
 */
export const useSwingTwistConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseSwingTwistConstraintOptions = {},
) =>
  useConstraint<Jolt.SwingTwistConstraint, SwingTwistConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castSwingTwist,
      api: (context) => createSwingTwistApi(context, options),
    },
  );
