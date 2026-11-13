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
  type VehicleWheelState,
} from "./internal/vehicle";
import type { JoltApi, QuatTuple, Vec3Tuple } from "./types";

export interface CarInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  modifier: boolean;
}

export type CarWheelState = VehicleWheelState;

export type CarState = VehicleState;

export interface UseCarOptions extends VehicleTireOptions {
  /** The chassis body's and the vehicle constraint's `stateId`, for `saveState`. */
  stateId?: number;
  position: Vec3Tuple;
  rotation?: QuatTuple;
  castType?: VehicleCastType;
  wheelSettings: {
    radius: number;
    width: number;
    /** Distance from the body centre along +Z to the front axle. */
    offsetForward: number;
    /** Distance from the body centre down along -Y to the wheel centres. */
    offsetDown: number;
  };
  vehicleSize: {
    length: number;
    width: number;
    height: number;
  };
  suspension?: { minLength: number; maxLength: number };
  maxSteerAngle?: number;
  maxPitchRollAngle?: number;
  driveType?: "rwd" | "fwd" | "awd";
  frontBackLimitedSlipRatio?: number;
  leftRightLimitedSlipRatio?: number;
  antiRollbar?: boolean;
  /** Total service-brake torque, split across the axles by `brakeBias`. */
  brakeTorque?: number;
  /** Fraction of `brakeTorque` sent to the front axle. 0.8 mimics a real car. */
  brakeBias?: number;
  /** Total handbrake torque. Applied to the rear axle only. */
  handBrakeTorque?: number;
  mass?: number;
  maxTorque?: number;
  /**
   * Fraction of `maxTorque` by fraction of the engine's maximum RPM, as
   * `[rpmFraction, torque]` points. Jolt's default rises from 0.8 to 1 at 0.66
   * and falls back to 0.8.
   */
  torqueCurve?: [rpmFraction: number, torque: number][];
  clutchStrength?: number;
  debug?: boolean;
  layer?: number;
}

export interface CarApi {
  carBody: Jolt.Body;
  constraint: Jolt.VehicleConstraint;
  /**
   * Returns a snapshot object that is **reused between calls** — copy anything
   * you need to keep.
   */
  update: (input: CarInput) => CarState;
  /** The drivetrain now, in an object that is **reused between calls**. */
  telemetry: () => VehicleTelemetry;
  debugGroup: Group | null;
  geometry: BufferGeometry;
}

const FL_WHEEL = 0;
const FR_WHEEL = 1;
const BL_WHEEL = 2;
const BR_WHEEL = 3;

const buildCarSettings = (jolt: JoltApi["Jolt"], mount: UseCarOptions) => {
  const {
    wheelSettings,
    vehicleSize,
    suspension = { minLength: 0.3, maxLength: 0.5 },
    maxSteerAngle = 30,
    maxPitchRollAngle = 60,
    driveType = "rwd",
    frontBackLimitedSlipRatio = 1.4,
    leftRightLimitedSlipRatio = 1.4,
    antiRollbar = true,
    brakeTorque = 6000,
    brakeBias = 0.8,
    handBrakeTorque = 8000,
    maxTorque = 500,
    torqueCurve,
    clutchStrength = 10,
  } = mount;

  const vehicleSettings = new jolt.VehicleConstraintSettings();
  vehicleSettings.mMaxPitchRollAngle = maxPitchRollAngle * (Math.PI / 180);
  vehicleSettings.mWheels.clear();

  const steerAngle = maxSteerAngle * (Math.PI / 180);
  const bias = Math.min(Math.max(brakeBias, 0), 1);

  if (brakeBias !== bias) {
    console.warn(
      `[r3f-jolt] useCar: brakeBias must be between 0 and 1, received ${brakeBias}.`,
    );
  }

  const wheelPositions: Vec3Tuple[] = [
    [
      vehicleSize.width / 2,
      -wheelSettings.offsetDown,
      wheelSettings.offsetForward,
    ],
    [
      -vehicleSize.width / 2,
      -wheelSettings.offsetDown,
      wheelSettings.offsetForward,
    ],
    [
      vehicleSize.width / 2,
      -wheelSettings.offsetDown,
      -wheelSettings.offsetForward,
    ],
    [
      -vehicleSize.width / 2,
      -wheelSettings.offsetDown,
      -wheelSettings.offsetForward,
    ],
  ];

  for (let index = 0; index < wheelPositions.length; index += 1) {
    const isFront = index === FL_WHEEL || index === FR_WHEEL;
    const wheel = new jolt.WheelSettingsWV();
    const wheelPosition = new jolt.Vec3(...wheelPositions[index]);

    wheel.mPosition = wheelPosition;
    jolt.destroy(wheelPosition);

    wheel.mMaxSteerAngle = isFront ? steerAngle : 0;
    wheel.mRadius = wheelSettings.radius;
    wheel.mWidth = wheelSettings.width;
    wheel.mSuspensionMinLength = suspension.minLength;
    wheel.mSuspensionMaxLength = suspension.maxLength;

    // Braking is independent of which wheels are driven. The service brake
    // acts on all four, biased forward because weight transfers to the front
    // under deceleration; the handbrake acts on the rear axle only.
    const axleShare = isFront ? bias : 1 - bias;
    wheel.mMaxBrakeTorque = (brakeTorque * axleShare) / 2;
    wheel.mMaxHandBrakeTorque = isFront ? 0 : handBrakeTorque / 2;

    vehicleSettings.mWheels.push_back(wheel);
  }

  const controllerSettings = new jolt.WheeledVehicleControllerSettings();
  controllerSettings.mEngine.mMaxTorque = maxTorque;
  if (torqueCurve) {
    setTorqueCurve(controllerSettings.mEngine, torqueCurve, "useCar");
  }
  controllerSettings.mTransmission.mClutchStrength = clutchStrength;
  controllerSettings.mDifferentials.clear();

  const addDifferential = (
    leftWheel: number,
    rightWheel: number,
    torqueRatio: number,
  ) => {
    const differential = new jolt.VehicleDifferentialSettings();
    differential.mLeftWheel = leftWheel;
    differential.mRightWheel = rightWheel;
    differential.mLimitedSlipRatio = leftRightLimitedSlipRatio;
    differential.mEngineTorqueRatio = torqueRatio;
    controllerSettings.mDifferentials.push_back(differential);
    jolt.destroy(differential);
  };

  if (driveType === "awd") {
    addDifferential(BL_WHEEL, BR_WHEEL, 0.5);
    addDifferential(FL_WHEEL, FR_WHEEL, 0.5);
  } else if (driveType === "fwd") {
    addDifferential(FL_WHEEL, FR_WHEEL, 1);
  } else {
    addDifferential(BL_WHEEL, BR_WHEEL, 1);
  }

  controllerSettings.mDifferentialLimitedSlipRatio = frontBackLimitedSlipRatio;
  vehicleSettings.mController = controllerSettings;

  if (antiRollbar) {
    vehicleSettings.mAntiRollBars.clear();

    const frontBar = new jolt.VehicleAntiRollBar();
    frontBar.mLeftWheel = FL_WHEEL;
    frontBar.mRightWheel = FR_WHEEL;
    vehicleSettings.mAntiRollBars.push_back(frontBar);
    jolt.destroy(frontBar);

    const rearBar = new jolt.VehicleAntiRollBar();
    rearBar.mLeftWheel = BL_WHEEL;
    rearBar.mRightWheel = BR_WHEEL;
    vehicleSettings.mAntiRollBars.push_back(rearBar);
    jolt.destroy(rearBar);
  }

  return vehicleSettings;
};

const buildCar = (
  api: JoltApi,
  scene: Scene,
  mount: UseCarOptions,
  latest: RefObject<UseCarOptions>,
): BuiltVehicle<CarApi> => {
  const { Jolt: jolt, bodyInterface, layers, state: world } = api;

  const {
    stateId,
    position,
    rotation = [0, 0, 0, 1],
    castType = "cylinder",
    wheelSettings,
    vehicleSize,
    mass = 1500,
    layer = layers.LAYER_MOVING,
  } = mount;

  const vehicle = createVehicle(api, scene, {
    hook: "useCar",
    stateId,
    position,
    rotation,
    size: vehicleSize,
    mass,
    layer,
    castType,
    wheelWidth: wheelSettings.width,
    buildSettings: () => buildCarSettings(jolt, mount),
  });

  const { body: carBody, constraint, state: carState, debugView } = vehicle;

  const controller = jolt.castObject(
    constraint.GetController(),
    jolt.WheeledVehicleController,
  );

  const tireCallbacks = installTireCallbacks(
    jolt,
    constraint,
    controller,
    mount,
    latest,
  );

  const reverseGuard = createReverseGuard(api, vehicle, stateId);

  const update = (input: CarInput): CarState => {
    if (world.disposed) return carState;

    let forward = input.forward ? 1 : input.backward ? -1 : 0;
    const right = input.right ? 1 : input.left ? -1 : 0;
    let brake = 0;
    let handbrake = 0;

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

    controller.SetDriverInput(forward, right, brake, handbrake);

    if (right || forward || brake || handbrake) {
      bodyInterface.ActivateBody(carBody.GetID());
    }

    return vehicle.sync();
  };

  return {
    vehicle,
    api: {
      carBody,
      constraint,
      update,
      telemetry: createTelemetry(api, controller),
      get debugGroup() {
        return debugView.current?.group ?? null;
      },
      geometry: vehicle.geometry,
    },
    release: () => {
      reverseGuard.stopKeeping();
      if (world.destroyed) return;
      for (const callbacks of tireCallbacks) jolt.destroy(callbacks);
    },
  };
};

export const useCar = (options: UseCarOptions) => {
  const carApi = useVehicle(options, buildCar);
  return [carApi] as [CarApi | undefined];
};
