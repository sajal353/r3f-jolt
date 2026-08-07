import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  createSpring,
  resolveMotorState,
  resolvePair,
  resolveSpace,
} from "./internal/constraintSettings";
import type {
  ConstraintSpace,
  LimitOptions,
  MotorLimits,
  MotorState,
  SpringOptions,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Input, Vec3Tuple } from "./types";

export type SixDOFAxis =
  | "translationX"
  | "translationY"
  | "translationZ"
  | "rotationX"
  | "rotationY"
  | "rotationZ";

export interface SixDOFAxisOptions {
  /** `free` moves without limit, `fixed` is locked, a range is bounded travel. */
  limits?: "free" | "fixed" | LimitOptions;
  limitsSpring?: SpringOptions;
  maxFriction?: number;
  motor?: MotorLimits & { state?: MotorState };
}

export interface UseSixDOFConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  position?: Vec3Tuple;
  position1?: Vec3Tuple;
  position2?: Vec3Tuple;
  axisX?: Vec3Tuple;
  axisX1?: Vec3Tuple;
  axisX2?: Vec3Tuple;
  axisY?: Vec3Tuple;
  axisY1?: Vec3Tuple;
  axisY2?: Vec3Tuple;
  axes?: Partial<Record<SixDOFAxis, SixDOFAxisOptions>>;
  /** Targets in constraint space, applied once the constraint exists. */
  targetPosition?: Vec3Tuple;
  targetVelocity?: Vec3Tuple;
  targetAngularVelocity?: Vec3Tuple;
}

export interface SixDOFConstraintExtras {
  setMotorState: (axis: SixDOFAxis, state: MotorState) => void;
  setTargetPosition: (position: Vec3Input) => void;
  setTargetVelocity: (velocity: Vec3Input) => void;
  setTargetAngularVelocity: (velocity: Vec3Input) => void;
  setTranslationLimits: (min: Vec3Input, max: Vec3Input) => void;
  setRotationLimits: (min: Vec3Input, max: Vec3Input) => void;
  setMaxFriction: (axis: SixDOFAxis, friction: number) => void;
}

export type SixDOFConstraintApi = ConstraintApi<Jolt.SixDOFConstraint> &
  SixDOFConstraintExtras;

const resolveAxis = (jolt: JoltModule, axis: SixDOFAxis) => {
  if (axis === "translationX") {
    return jolt.SixDOFConstraintSettings_EAxis_TranslationX;
  }
  if (axis === "translationY") {
    return jolt.SixDOFConstraintSettings_EAxis_TranslationY;
  }
  if (axis === "translationZ") {
    return jolt.SixDOFConstraintSettings_EAxis_TranslationZ;
  }
  if (axis === "rotationX") {
    return jolt.SixDOFConstraintSettings_EAxis_RotationX;
  }
  if (axis === "rotationY") {
    return jolt.SixDOFConstraintSettings_EAxis_RotationY;
  }
  return jolt.SixDOFConstraintSettings_EAxis_RotationZ;
};

const applyAxis = (
  jolt: JoltModule,
  settings: Jolt.SixDOFConstraintSettings,
  axis: SixDOFAxis,
  options: SixDOFAxisOptions,
) => {
  const index = resolveAxis(jolt, axis);
  const { limits, limitsSpring, maxFriction, motor } = options;

  if (limits === "free") settings.MakeFreeAxis(index);
  else if (limits === "fixed") settings.MakeFixedAxis(index);
  else if (limits) settings.SetLimitedAxis(index, limits.min, limits.max);

  if (limitsSpring) {
    const spring = createSpring(jolt, limitsSpring);
    settings.set_mLimitsSpringSettings(index, spring);
    jolt.destroy(spring);
  }

  if (maxFriction !== undefined) {
    settings.set_mMaxFriction(index, maxFriction);
  }

  if (motor) {
    const motorSettings = new jolt.MotorSettings();

    if (motor.minForceLimit !== undefined) {
      motorSettings.mMinForceLimit = motor.minForceLimit;
    }
    if (motor.maxForceLimit !== undefined) {
      motorSettings.mMaxForceLimit = motor.maxForceLimit;
    }
    if (motor.minTorqueLimit !== undefined) {
      motorSettings.mMinTorqueLimit = motor.minTorqueLimit;
    }
    if (motor.maxTorqueLimit !== undefined) {
      motorSettings.mMaxTorqueLimit = motor.maxTorqueLimit;
    }

    if (motor.spring) {
      const spring = createSpring(jolt, motor.spring);
      motorSettings.mSpringSettings = spring;
      jolt.destroy(spring);
    }

    settings.set_mMotorSettings(index, motorSettings);
    jolt.destroy(motorSettings);
  }
};

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseSixDOFConstraintOptions,
) => {
  const settings = new jolt.SixDOFConstraintSettings();
  const [position1, position2] = resolvePair(
    options.position,
    options.position1,
    options.position2,
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

  if (position1) settings.mPosition1 = temps.rvec3(position1);
  if (position2) settings.mPosition2 = temps.rvec3(position2);
  if (axisX1) settings.mAxisX1 = temps.vec3(axisX1);
  if (axisX2) settings.mAxisX2 = temps.vec3(axisX2);
  if (axisY1) settings.mAxisY1 = temps.vec3(axisY1);
  if (axisY2) settings.mAxisY2 = temps.vec3(axisY2);

  for (const [axis, axisOptions] of Object.entries(options.axes ?? {})) {
    applyAxis(jolt, settings, axis as SixDOFAxis, axisOptions);
  }

  return settings;
};

const castSixDOF = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.SixDOFConstraint);

const createSixDOFApi = (
  {
    constraint,
    usable,
    activate,
    jolt,
    temps,
  }: ConstraintApiContext<Jolt.SixDOFConstraint>,
  options: UseSixDOFConstraintOptions,
): SixDOFConstraintExtras => {
  const setMotorState = (axis: SixDOFAxis, state: MotorState) => {
    if (!usable()) return;
    constraint.SetMotorState(
      resolveAxis(jolt, axis),
      resolveMotorState(jolt, state),
    );
    activate();
  };

  const setTargetPosition = (position: Vec3Input) => {
    if (!usable()) return;
    constraint.SetTargetPositionCS(temps.vec3(position));
    activate();
  };

  const setTargetVelocity = (velocity: Vec3Input) => {
    if (!usable()) return;
    constraint.SetTargetVelocityCS(temps.vec3(velocity));
    activate();
  };

  const setTargetAngularVelocity = (velocity: Vec3Input) => {
    if (!usable()) return;
    constraint.SetTargetAngularVelocityCS(temps.vec3(velocity));
    activate();
  };

  const setTranslationLimits = (min: Vec3Input, max: Vec3Input) => {
    if (!usable()) return;
    constraint.SetTranslationLimits(temps.vec3(min), temps.vec3(max));
    activate();
  };

  const setRotationLimits = (min: Vec3Input, max: Vec3Input) => {
    if (!usable()) return;
    constraint.SetRotationLimits(temps.vec3(min), temps.vec3(max));
    activate();
  };

  const setMaxFriction = (axis: SixDOFAxis, friction: number) => {
    if (!usable()) return;
    constraint.SetMaxFriction(resolveAxis(jolt, axis), friction);
    activate();
  };

  if (options.targetPosition) setTargetPosition(options.targetPosition);
  if (options.targetVelocity) setTargetVelocity(options.targetVelocity);
  if (options.targetAngularVelocity) {
    setTargetAngularVelocity(options.targetAngularVelocity);
  }

  for (const [axis, axisOptions] of Object.entries(options.axes ?? {})) {
    if (axisOptions.motor?.state) {
      setMotorState(axis as SixDOFAxis, axisOptions.motor.state);
    }
  }

  return {
    setMotorState,
    setTargetPosition,
    setTargetVelocity,
    setTargetAngularVelocity,
    setTranslationLimits,
    setRotationLimits,
    setMaxFriction,
  };
};

/**
 * The general case: every translation and rotation axis is separately free,
 * fixed or limited, with its own spring, friction and motor. The other seven
 * constraint hooks are the ergonomic shortcuts for its common configurations.
 */
export const useSixDOFConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseSixDOFConstraintOptions = {},
) =>
  useConstraint<Jolt.SixDOFConstraint, SixDOFConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castSixDOF,
      api: (context) => createSixDOFApi(context, options),
    },
  );
