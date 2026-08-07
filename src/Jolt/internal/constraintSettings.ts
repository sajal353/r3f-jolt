import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

export type ConstraintSpace = "world" | "local";

export type MotorState = "off" | "velocity" | "position" | "positionAndVelocity";

/**
 * Frequency and stiffness are two ways of describing the same spring, and Jolt
 * picks between them with `mMode`. Setting `stiffness` selects that mode; leave
 * it out and `frequency` is used.
 */
export interface SpringOptions {
  frequency?: number;
  stiffness?: number;
  damping?: number;
}

export interface MotorLimits {
  minForceLimit?: number;
  maxForceLimit?: number;
  minTorqueLimit?: number;
  maxTorqueLimit?: number;
  spring?: SpringOptions;
}

export interface AngularMotorOptions extends MotorLimits {
  state?: MotorState;
  targetAngle?: number;
  targetAngularVelocity?: number;
}

export interface LinearMotorOptions extends MotorLimits {
  state?: MotorState;
  targetPosition?: number;
  targetVelocity?: number;
}

export interface LimitOptions {
  min: number;
  max: number;
}

/**
 * Most joints want the same point or axis on both bodies, so each hook takes a
 * shared value with per-body overrides for the cases that do not.
 */
export const resolvePair = <T>(
  shared: T | undefined,
  first: T | undefined,
  second: T | undefined,
) => [first ?? shared, second ?? shared] as const;

export const applyLimits = (
  settings: { mLimitsMin: number; mLimitsMax: number },
  limits: LimitOptions | undefined,
) => {
  if (!limits) return;

  settings.mLimitsMin = limits.min;
  settings.mLimitsMax = limits.max;
};

export const resolveSpace = (jolt: JoltModule, space: ConstraintSpace = "world") =>
  space === "local"
    ? jolt.EConstraintSpace_LocalToBodyCOM
    : jolt.EConstraintSpace_WorldSpace;

export const resolveMotorState = (jolt: JoltModule, state: MotorState) => {
  if (state === "velocity") return jolt.EMotorState_Velocity;
  if (state === "position") return jolt.EMotorState_Position;
  if (state === "positionAndVelocity") return jolt.EMotorState_PositionAndVelocity;
  return jolt.EMotorState_Off;
};

/**
 * Returns a spring the caller owns. Assigning it to a settings field copies by
 * value, so destroy it once the assignment is done — reading the field back and
 * mutating it in place would write to a copy instead.
 */
export const createSpring = (jolt: JoltModule, options: SpringOptions) => {
  const spring = new jolt.SpringSettings();

  if (options.stiffness !== undefined) {
    spring.mMode = jolt.ESpringMode_StiffnessAndDamping;
    spring.mStiffness = options.stiffness;
  } else if (options.frequency !== undefined) {
    spring.mMode = jolt.ESpringMode_FrequencyAndDamping;
    spring.mFrequency = options.frequency;
  }

  if (options.damping !== undefined) spring.mDamping = options.damping;

  return spring;
};

export const applySpring = (
  jolt: JoltModule,
  assign: (spring: Jolt.SpringSettings) => void,
  options: SpringOptions | undefined,
) => {
  if (!options) return;

  const spring = createSpring(jolt, options);
  assign(spring);
  jolt.destroy(spring);
};

export const applyMotor = (
  jolt: JoltModule,
  assign: (motor: Jolt.MotorSettings) => void,
  options: MotorLimits | undefined,
) => {
  if (!options) return;

  const motor = new jolt.MotorSettings();

  if (options.minForceLimit !== undefined) motor.mMinForceLimit = options.minForceLimit;
  if (options.maxForceLimit !== undefined) motor.mMaxForceLimit = options.maxForceLimit;
  if (options.minTorqueLimit !== undefined) {
    motor.mMinTorqueLimit = options.minTorqueLimit;
  }
  if (options.maxTorqueLimit !== undefined) {
    motor.mMaxTorqueLimit = options.maxTorqueLimit;
  }

  applySpring(jolt, (spring) => (motor.mSpringSettings = spring), options.spring);

  assign(motor);
  jolt.destroy(motor);
};
