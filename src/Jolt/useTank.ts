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

export interface TankInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

export interface UseTankOptions
  extends Pick<VehicleTireOptions, "combineFriction"> {
  /** The hull body's and the vehicle constraint's `stateId`, for `saveState`. */
  stateId?: number;
  position: Vec3Tuple;
  rotation?: QuatTuple;
  /** `"ray"` is cheapest, but its wheels catch on the side of what they meet. */
  castType?: VehicleCastType;
  vehicleSize: {
    length: number;
    width: number;
    height: number;
  };
  wheelSettings: {
    radius: number;
    width: number;
    /** Wheels per track, front to back. The rearmost is driven. */
    count?: number;
    /** Distance along Z from the first wheel to the last. */
    span: number;
    /** Distance from the hull centre down along -Y to the road wheels. */
    offsetDown: number;
    /** How far above the road wheels the first and last wheels ride. */
    endRaise?: number;
  };
  suspension?: { minLength: number; maxLength: number; frequency?: number };
  maxPitchRollAngle?: number;
  /** Brake torque per track. */
  brakeTorque?: number;
  /**
   * Moment of inertia of a track, in kg m². A light track takes a whole step of
   * engine torque before it grips, and slips at a launch.
   */
  trackInertia?: number;
  /** Fraction of a track's spin lost per second. */
  trackDamping?: number;
  /** Friction of a track on the ground, along it and across it. */
  trackFriction?: { longitudinal: number; lateral: number };
  /** Speed multiplier of the inside track in a moving turn. */
  turnRatio?: number;
  /** Below this speed, in m/s, turning with no throttle spins on the spot. */
  pivotSpeed?: number;
  mass?: number;
  maxTorque?: number;
  /** Fraction of `maxTorque` by fraction of the engine's maximum RPM. */
  torqueCurve?: [rpmFraction: number, torque: number][];
  debug?: boolean;
  layer?: number;
}

export interface TankApi {
  body: Jolt.Body;
  constraint: Jolt.VehicleConstraint;
  /**
   * Returns a snapshot object that is **reused between calls** — copy anything
   * you need to keep. Wheels are the left track front to back, then the right.
   */
  update: (input: TankInput) => VehicleState;
  /** The drivetrain now, in an object that is **reused between calls**. */
  telemetry: () => VehicleTelemetry;
  debugGroup: Group | null;
  geometry: BufferGeometry;
}

const TRACK_SIDES = [1, -1];

const buildTankSettings = (jolt: JoltApi["Jolt"], mount: UseTankOptions) => {
  const {
    vehicleSize,
    wheelSettings,
    suspension = { minLength: 0.3, maxLength: 0.5, frequency: 1 },
    maxPitchRollAngle = 60,
    brakeTorque = 15000,
    trackInertia = 100,
    trackDamping = 0.05,
    trackFriction,
    maxTorque = 500,
    torqueCurve,
  } = mount;

  const { count = 9, span, offsetDown, endRaise = 0.3 } = wheelSettings;

  if (count < 2) {
    throw new Error(
      `[r3f-jolt] useTank: a track needs at least 2 wheels, received ${count}.`,
    );
  }

  const vehicleSettings = new jolt.VehicleConstraintSettings();
  vehicleSettings.mMaxPitchRollAngle = maxPitchRollAngle * (Math.PI / 180);
  vehicleSettings.mWheels.clear();

  const controllerSettings = new jolt.TrackedVehicleControllerSettings();
  controllerSettings.mEngine.mMaxTorque = maxTorque;
  if (torqueCurve) {
    setTorqueCurve(controllerSettings.mEngine, torqueCurve, "useTank");
  }

  let added = 0;

  TRACK_SIDES.forEach((side, trackIndex) => {
    const track = controllerSettings.get_mTracks(trackIndex);
    track.mMaxBrakeTorque = brakeTorque;
    track.mInertia = trackInertia;
    track.mAngularDamping = trackDamping;
    track.mWheels.clear();

    for (let index = 0; index < count; index += 1) {
      // The first and last wheels carry the track up over what it meets, so
      // they ride high and have no travel.
      const isEnd = index === 0 || index === count - 1;
      const wheel = new jolt.WheelSettingsTV();
      const wheelPosition = new jolt.Vec3(
        (side * vehicleSize.width) / 2,
        -offsetDown + (isEnd ? endRaise : 0),
        span / 2 - (index * span) / (count - 1),
      );

      wheel.mPosition = wheelPosition;
      jolt.destroy(wheelPosition);

      wheel.mRadius = wheelSettings.radius;
      wheel.mWidth = wheelSettings.width;
      wheel.mSuspensionMinLength = suspension.minLength;
      wheel.mSuspensionMaxLength = isEnd
        ? suspension.minLength
        : suspension.maxLength;
      wheel.mSuspensionSpring.mFrequency = suspension.frequency ?? 1;

      if (trackFriction) {
        wheel.mLongitudinalFriction = trackFriction.longitudinal;
        wheel.mLateralFriction = trackFriction.lateral;
      }

      track.mWheels.push_back(added);
      vehicleSettings.mWheels.push_back(wheel);
      added += 1;
    }

    track.mDrivenWheel = added - 1;
  });

  vehicleSettings.mController = controllerSettings;
  return vehicleSettings;
};

const buildTank = (
  api: JoltApi,
  scene: Scene,
  mount: UseTankOptions,
  latest: RefObject<UseTankOptions>,
): BuiltVehicle<TankApi> => {
  const { Jolt: jolt, bodyInterface, layers, state: world } = api;

  const {
    stateId,
    position,
    rotation = [0, 0, 0, 1],
    castType = "cylinder",
    vehicleSize,
    wheelSettings,
    turnRatio = 0.6,
    pivotSpeed = 1,
    mass = 4000,
    layer = layers.LAYER_MOVING,
  } = mount;

  const vehicle = createVehicle(api, scene, {
    hook: "useTank",
    stateId,
    position,
    rotation,
    size: vehicleSize,
    mass,
    layer,
    castType,
    wheelWidth: wheelSettings.width,
    buildSettings: () => buildTankSettings(jolt, mount),
  });

  const { body, constraint, state: tankState, debugView } = vehicle;

  const controller = jolt.castObject(
    constraint.GetController(),
    jolt.TrackedVehicleController,
  );

  const tireCallbacks = installTireCallbacks(
    jolt,
    constraint,
    null,
    mount,
    latest,
  );

  const reverseGuard = createReverseGuard(api, vehicle, stateId);

  const update = (input: TankInput) => {
    if (world.disposed) return tankState;

    let forward = input.forward ? 1 : input.backward ? -1 : 0;
    let brake = input.brake ? 1 : 0;
    let leftRatio = 1;
    let rightRatio = 1;

    if (reverseGuard.mustBrake(forward)) {
      forward = 0;
      brake = 1;
    }

    const turning = input.left !== input.right;

    if (turning) {
      const velocity = body.GetLinearVelocity();
      const canPivot =
        brake === 0 &&
        forward === 0 &&
        velocity.Length() < pivotSpeed;

      if (canPivot) {
        forward = 1;
        leftRatio = input.left ? -1 : 1;
        rightRatio = input.left ? 1 : -1;
      } else {
        leftRatio = input.left ? turnRatio : 1;
        rightRatio = input.left ? 1 : turnRatio;
      }
    }

    controller.SetDriverInput(forward, leftRatio, rightRatio, brake);

    if (forward || brake) {
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

export const useTank = (options: UseTankOptions) => {
  const tankApi = useVehicle(options, buildTank);
  return [tankApi] as [TankApi | undefined];
};
