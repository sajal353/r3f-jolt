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
  ConstraintSpace,
  LimitOptions,
  LinearMotorOptions,
  MotorState,
  SpringOptions,
} from "./internal/constraintSettings";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseSliderConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  /** Takes the current body positions as the anchors and ignores `point`. */
  autoDetectPoint?: boolean;
  point?: Vec3Tuple;
  point1?: Vec3Tuple;
  point2?: Vec3Tuple;
  /** The line the joint slides along. */
  sliderAxis?: Vec3Tuple;
  sliderAxis1?: Vec3Tuple;
  sliderAxis2?: Vec3Tuple;
  normalAxis?: Vec3Tuple;
  normalAxis1?: Vec3Tuple;
  normalAxis2?: Vec3Tuple;
  /** Metres along the slider axis. Unlimited when left out. */
  limits?: LimitOptions;
  limitsSpring?: SpringOptions;
  maxFrictionForce?: number;
  motor?: LinearMotorOptions;
}

export interface SliderConstraintExtras {
  setMotorState: (state: MotorState) => void;
  setTargetPosition: (position: number) => void;
  setTargetVelocity: (velocity: number) => void;
  getCurrentPosition: () => number;
  setLimits: (limits: LimitOptions) => void;
  setMaxFrictionForce: (force: number) => void;
}

export type SliderConstraintApi = ConstraintApi<Jolt.SliderConstraint> &
  SliderConstraintExtras;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseSliderConstraintOptions,
) => {
  const settings = new jolt.SliderConstraintSettings();
  const [point1, point2] = resolvePair(
    options.point,
    options.point1,
    options.point2,
  );
  const [sliderAxis1, sliderAxis2] = resolvePair(
    options.sliderAxis,
    options.sliderAxis1,
    options.sliderAxis2,
  );
  const [normalAxis1, normalAxis2] = resolvePair(
    options.normalAxis,
    options.normalAxis1,
    options.normalAxis2,
  );

  settings.mSpace = resolveSpace(jolt, options.space);
  settings.mAutoDetectPoint = options.autoDetectPoint ?? false;

  if (point1) settings.mPoint1 = temps.rvec3(point1);
  if (point2) settings.mPoint2 = temps.rvec3(point2);
  if (sliderAxis1) settings.mSliderAxis1 = temps.vec3(sliderAxis1);
  if (sliderAxis2) settings.mSliderAxis2 = temps.vec3(sliderAxis2);
  if (normalAxis1) settings.mNormalAxis1 = temps.vec3(normalAxis1);
  if (normalAxis2) settings.mNormalAxis2 = temps.vec3(normalAxis2);
  if (options.maxFrictionForce !== undefined) {
    settings.mMaxFrictionForce = options.maxFrictionForce;
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

const castSlider = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.SliderConstraint);

const createSliderApi = (
  {
    constraint,
    usable,
    activate,
    jolt,
  }: ConstraintApiContext<Jolt.SliderConstraint>,
  motor: LinearMotorOptions | undefined,
): SliderConstraintExtras => {
  const setMotorState = (state: MotorState) => {
    if (!usable()) return;
    constraint.SetMotorState(resolveMotorState(jolt, state));
    activate();
  };

  const setTargetPosition = (position: number) => {
    if (!usable()) return;
    constraint.SetTargetPosition(position);
    activate();
  };

  const setTargetVelocity = (velocity: number) => {
    if (!usable()) return;
    constraint.SetTargetVelocity(velocity);
    activate();
  };

  const getCurrentPosition = () =>
    usable() ? constraint.GetCurrentPosition() : 0;

  const setLimits = (limits: LimitOptions) => {
    if (!usable()) return;
    constraint.SetLimits(limits.min, limits.max);
    activate();
  };

  const setMaxFrictionForce = (force: number) => {
    if (!usable()) return;
    constraint.SetMaxFrictionForce(force);
    activate();
  };

  if (motor?.targetPosition !== undefined) {
    setTargetPosition(motor.targetPosition);
  }
  if (motor?.targetVelocity !== undefined) {
    setTargetVelocity(motor.targetVelocity);
  }
  if (motor?.state) setMotorState(motor.state);

  return {
    setMotorState,
    setTargetPosition,
    setTargetVelocity,
    getCurrentPosition,
    setLimits,
    setMaxFrictionForce,
  };
};

/**
 * One translational degree of freedom along a shared axis — lifts, pistons and
 * drawers. Add a `motor` to drive it, or `limits` to bound its travel.
 */
export const useSliderConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UseSliderConstraintOptions = {},
) =>
  useConstraint<Jolt.SliderConstraint, SliderConstraintExtras>(
    body1,
    body2,
    options,
    {
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castSlider,
      api: (context) => createSliderApi(context, options.motor),
    },
  );
