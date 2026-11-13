import type { BufferGeometry, Group, Scene } from "three";
import type { RefObject } from "react";
import type Jolt from "jolt-physics";
import {
  type BuiltVehicle,
  createReverseGuard,
  createTelemetry,
  createVehicle,
  installTireCallbacks,
  setTorqueCurve,
  useVehicle,
  type VehicleCastType,
  type VehicleState,
  type VehicleTelemetry,
  type VehicleTireOptions,
} from "./internal/vehicle";
import type { JoltApi, QuatTuple, Vec3Tuple } from "./types";

export interface MotorcycleInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  modifier: boolean;
}

export interface UseMotorcycleOptions extends VehicleTireOptions {
  /** The frame body's and the vehicle constraint's `stateId`, for `saveState`. */
  stateId?: number;
  position: Vec3Tuple;
  rotation?: QuatTuple;
  castType?: VehicleCastType;
  vehicleSize: {
    length: number;
    width: number;
    height: number;
  };
  wheelSettings: {
    radius: number;
    width: number;
    /** Distance from the body centre along Z to each axle. */
    offsetForward: number;
    /** Distance from the body centre down along -Y to the wheel centres. */
    offsetDown: number;
  };
  suspension?: {
    minLength: number;
    maxLength: number;
    frontFrequency?: number;
    rearFrequency?: number;
  };
  /** Rake of the front suspension and steering axis, in degrees. */
  casterAngle?: number;
  maxSteerAngle?: number;
  /** How fast the bars turn: full lock per `1 / steerRate` seconds. */
  steerRate?: number;
  maxPitchRollAngle?: number;
  /**
   * The controller that leans the bike into a turn and stands it up after. The
   * default spring is stable up to a step of about 1/35 s.
   */
  lean?: {
    /** In degrees. */
    maxAngle?: number;
    springConstant?: number;
    springDamping?: number;
    integrationCoefficient?: number;
    integrationCoefficientDecay?: number;
    smoothingFactor?: number;
  };
  /** Total service-brake torque, split across the wheels by `brakeBias`. */
  brakeTorque?: number;
  /** Fraction of `brakeTorque` sent to the front wheel. */
  brakeBias?: number;
  /** Applied to the rear wheel only. */
  handBrakeTorque?: number;
  mass?: number;
  maxTorque?: number;
  /** Fraction of `maxTorque` by fraction of the engine's maximum RPM. */
  torqueCurve?: [rpmFraction: number, torque: number][];
  clutchStrength?: number;
  debug?: boolean;
  layer?: number;
}

export interface MotorcycleApi {
  body: Jolt.Body;
  constraint: Jolt.VehicleConstraint;
  /**
   * Returns a snapshot object that is **reused between calls** — copy anything
   * you need to keep. Wheel 0 is the front.
   */
  update: (input: MotorcycleInput) => VehicleState;
  /** The drivetrain now, in an object that is **reused between calls**. */
  telemetry: () => VehicleTelemetry;
  /** With it off, nothing holds the bike up. */
  setLeanController: (enabled: boolean) => void;
  debugGroup: Group | null;
  geometry: BufferGeometry;
}

const REAR_WHEEL = 1;

const MIN_RPM = 1000;
const MAX_RPM = 10000;
const SHIFT_DOWN_RPM = 2000;
const SHIFT_UP_RPM = 8000;
const GEAR_RATIOS = [2.27, 1.63, 1.3, 1.09, 0.96, 0.88];
const REVERSE_RATIO = -4;
// Primary and final drive together: a motorcycle has no differential to split.
const DRIVE_RATIO = 4.825;

const DEFAULT_LEAN_DAMPING = 1000;
// On the default bike, damping 1000 holds at a step of 1/35 s and throws it over
// at 1/30 s, and damping 500 holds at 1/30 s.
const MOST_STABLE_LEAN_DAMPING_STEP = 30;

const buildMotorcycleSettings = (
  jolt: JoltApi["Jolt"],
  mount: UseMotorcycleOptions,
) => {
  const {
    wheelSettings,
    suspension,
    casterAngle = 30,
    maxSteerAngle = 30,
    maxPitchRollAngle = 60,
    lean = {},
    brakeTorque = 750,
    brakeBias = 2 / 3,
    handBrakeTorque = 1500,
    maxTorque = 150,
    torqueCurve,
    clutchStrength = 2,
  } = mount;

  const {
    minLength = 0.3,
    maxLength = 0.5,
    frontFrequency = 1.5,
    rearFrequency = 2,
  } = suspension ?? {};

  const bias = Math.min(Math.max(brakeBias, 0), 1);

  if (brakeBias !== bias) {
    console.warn(
      `[r3f-jolt] useMotorcycle: brakeBias must be between 0 and 1, received ${brakeBias}.`,
    );
  }

  const vehicleSettings = new jolt.VehicleConstraintSettings();
  vehicleSettings.mMaxPitchRollAngle = maxPitchRollAngle * (Math.PI / 180);
  vehicleSettings.mWheels.clear();

  const caster = casterAngle * (Math.PI / 180);

  const addWheel = (isFront: boolean) => {
    const wheel = new jolt.WheelSettingsWV();
    const wheelPosition = new jolt.Vec3(
      0,
      -wheelSettings.offsetDown,
      isFront ? wheelSettings.offsetForward : -wheelSettings.offsetForward,
    );
    wheel.mPosition = wheelPosition;
    jolt.destroy(wheelPosition);

    if (isFront) {
      const down = new jolt.Vec3(0, -Math.cos(caster), Math.sin(caster));
      const up = new jolt.Vec3(0, Math.cos(caster), -Math.sin(caster));
      wheel.mSuspensionDirection = down;
      wheel.mSteeringAxis = up;
      jolt.destroy(down);
      jolt.destroy(up);
    }

    wheel.mMaxSteerAngle = isFront ? maxSteerAngle * (Math.PI / 180) : 0;
    wheel.mRadius = wheelSettings.radius;
    wheel.mWidth = wheelSettings.width;
    wheel.mSuspensionMinLength = minLength;
    wheel.mSuspensionMaxLength = maxLength;
    wheel.mSuspensionSpring.mFrequency = isFront
      ? frontFrequency
      : rearFrequency;
    wheel.mMaxBrakeTorque = brakeTorque * (isFront ? bias : 1 - bias);
    wheel.mMaxHandBrakeTorque = isFront ? 0 : handBrakeTorque;

    vehicleSettings.mWheels.push_back(wheel);
  };

  addWheel(true);
  addWheel(false);

  const controllerSettings = new jolt.MotorcycleControllerSettings();
  const { mEngine: engine, mTransmission: transmission } = controllerSettings;

  engine.mMaxTorque = maxTorque;
  engine.mMinRPM = MIN_RPM;
  engine.mMaxRPM = MAX_RPM;
  if (torqueCurve) setTorqueCurve(engine, torqueCurve, "useMotorcycle");

  transmission.mShiftDownRPM = SHIFT_DOWN_RPM;
  transmission.mShiftUpRPM = SHIFT_UP_RPM;
  transmission.mClutchStrength = clutchStrength;
  transmission.mGearRatios.clear();
  for (const ratio of GEAR_RATIOS) transmission.mGearRatios.push_back(ratio);
  transmission.mReverseGearRatios.clear();
  transmission.mReverseGearRatios.push_back(REVERSE_RATIO);

  controllerSettings.mDifferentials.clear();
  const drive = new jolt.VehicleDifferentialSettings();
  drive.mLeftWheel = -1;
  drive.mRightWheel = REAR_WHEEL;
  drive.mDifferentialRatio = DRIVE_RATIO;
  controllerSettings.mDifferentials.push_back(drive);
  jolt.destroy(drive);

  if (lean.maxAngle !== undefined) {
    controllerSettings.mMaxLeanAngle = lean.maxAngle * (Math.PI / 180);
  }
  if (lean.springConstant !== undefined) {
    controllerSettings.mLeanSpringConstant = lean.springConstant;
  }
  if (lean.springDamping !== undefined) {
    controllerSettings.mLeanSpringDamping = lean.springDamping;
  }
  if (lean.integrationCoefficient !== undefined) {
    controllerSettings.mLeanSpringIntegrationCoefficient =
      lean.integrationCoefficient;
  }
  if (lean.integrationCoefficientDecay !== undefined) {
    controllerSettings.mLeanSpringIntegrationCoefficientDecay =
      lean.integrationCoefficientDecay;
  }
  if (lean.smoothingFactor !== undefined) {
    controllerSettings.mLeanSmoothingFactor = lean.smoothingFactor;
  }

  vehicleSettings.mController = controllerSettings;
  return vehicleSettings;
};

const buildMotorcycle = (
  api: JoltApi,
  scene: Scene,
  mount: UseMotorcycleOptions,
  latest: RefObject<UseMotorcycleOptions>,
): BuiltVehicle<MotorcycleApi> => {
  const { Jolt: jolt, bodyInterface, layers, state: world } = api;

  const {
    stateId,
    position,
    rotation = [0, 0, 0, 1],
    castType = "cylinder",
    vehicleSize,
    wheelSettings,
    steerRate = 4,
    lean,
    mass = 240,
    layer = layers.LAYER_MOVING,
  } = mount;

  const leanDamping = lean?.springDamping ?? DEFAULT_LEAN_DAMPING;

  const vehicle = createVehicle(api, scene, {
    hook: "useMotorcycle",
    stateId,
    position,
    rotation,
    size: vehicleSize,
    mass,
    layer,
    castType,
    wheelWidth: wheelSettings.width,
    // A leaned tire has to roll on its shoulder, not its edge.
    convexRadiusFraction: 1,
    buildSettings: () => buildMotorcycleSettings(jolt, mount),
  });

  const { body, constraint, state: bikeState, debugView } = vehicle;

  const controller = jolt.castObject(
    constraint.GetController(),
    jolt.MotorcycleController,
  );

  const tireCallbacks = installTireCallbacks(
    jolt,
    constraint,
    controller,
    mount,
    latest,
  );

  const reverseGuard = createReverseGuard(api, vehicle, stateId);

  let steer = 0;
  let steerTarget = 0;
  let warnedOfStep = false;

  // On the step rather than in `update`, so the bars turn at the same rate
  // however often `update` is called. Snapping them over throws the bike down.
  const stopSteering = api.steps.add("before", function turnBars(delta) {
    if (!warnedOfStep && leanDamping * delta > MOST_STABLE_LEAN_DAMPING_STEP) {
      warnedOfStep = true;
      console.warn(
        `[r3f-jolt] useMotorcycle: a step of ${delta.toFixed(4)} s is too long for lean.springDamping ${leanDamping}, and the lean controller can throw the bike over. Step at 1/60 s, or halve lean.springConstant and lean.springDamping.`,
      );
    }

    const most = steerRate * delta;
    steer += Math.min(Math.max(steerTarget - steer, -most), most);
    controller.SetRightInput(steer);
  });

  const stopKeeping =
    stateId === undefined
      ? () => {}
      : api.snapshots.keep({
          tag: "motorcycle",
          owner: "constraint",
          id: stateId,
          save: () => [steer, steerTarget],
          restore: ([savedSteer, savedTarget]) => {
            steer = savedSteer;
            steerTarget = savedTarget;
          },
        });

  const update = (input: MotorcycleInput) => {
    if (world.disposed) return bikeState;

    let forward = input.forward ? 1 : input.backward ? -1 : 0;
    let brake = 0;
    let handbrake = 0;

    steerTarget = input.right ? 1 : input.left ? -1 : 0;

    if (reverseGuard.mustBrake(forward)) {
      forward = 0;
      brake = 1;
    }

    if (input.handbrake) {
      forward = 0;
      handbrake = 1;
    }

    if (!input.modifier) {
      forward = forward > 0 ? forward * 0.5 : forward;
    }

    controller.SetDriverInput(forward, steer, brake, handbrake);

    if (steerTarget || forward || brake || handbrake) {
      bodyInterface.ActivateBody(body.GetID());
    }

    return vehicle.sync();
  };

  return {
    vehicle,
    api: {
      body,
      constraint,
      update,
      telemetry: createTelemetry(api, controller),
      setLeanController: (enabled) => {
        if (world.disposed) return;
        controller.EnableLeanController(enabled);
      },
      get debugGroup() {
        return debugView.current?.group ?? null;
      },
      geometry: vehicle.geometry,
    },
    release: () => {
      stopSteering();
      stopKeeping();
      reverseGuard.stopKeeping();
      if (world.destroyed) return;
      for (const callbacks of tireCallbacks) jolt.destroy(callbacks);
    },
  };
};

export const useMotorcycle = (options: UseMotorcycleOptions) => {
  const motorcycleApi = useVehicle(options, buildMotorcycle);
  return [motorcycleApi] as [MotorcycleApi | undefined];
};
