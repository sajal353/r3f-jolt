import { useEffect, useRef, useState, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import {
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Quaternion,
  type Scene,
  Vector3,
} from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "../useJolt";
import { shapeToGeometry } from "./shapeToGeometry";
import { syncObject } from "./syncObject";
import { createDebugMaterial, disposeDebugMaterial } from "./debugMaterial";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./debugView";
import { useHandlerRef } from "./useHandlerRef";
import { shapeFromResult } from "./useBody";
import type { JoltApi, QuatTuple, Vec3Tuple } from "../types";

export type VehicleCastType = "cylinder" | "sphere" | "ray";

export interface VehicleWheelState {
  index: number;
  position: Vector3;
  rotation: Quaternion;
}

export interface VehicleState {
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  wheels: VehicleWheelState[];
}

/** The drivetrain, for a tachometer, engine pitch or shift sounds. */
export interface VehicleTelemetry {
  rpm: number;
  /** 0 is neutral, and a negative gear is reverse. */
  gear: number;
  /** Engine turns per turn of the differential, in this gear. */
  ratio: number;
  /** 0 is disengaged, 1 is locked to the wheels. */
  clutch: number;
}

/** One tire on the ground, during a step. The object is reused between calls. */
export interface TireContact {
  wheel: number;
  /** What the tire is on, as `body.GetID().GetIndexAndSequenceNumber()`. */
  readonly bodyID: number;
  suspensionImpulse: number;
  longitudinalFriction: number;
  lateralFriction: number;
  /** Slip ratio along the tire. */
  longitudinalSlip: number;
  /** Slip angle across the tire, in radians. */
  lateralSlip: number;
  deltaTime: number;
  /** Most the tire may push along itself. Starts as friction × suspension impulse. */
  longitudinalImpulse: number;
  /** Most the tire may push across itself. Starts as friction × suspension impulse. */
  lateralImpulse: number;
}

export type TireFrictionDirection = "longitudinal" | "lateral";

export interface VehicleTireOptions {
  /**
   * Sets each grounded tire's impulse limits, once per solver iteration, so
   * several times a step. Must be in place at mount.
   */
  tireGrip?: (tire: TireContact) => void;
  /**
   * Mixes a tire's friction with `body`'s, by default `√(tire × body)`, once per
   * direction. Must be in place at mount.
   */
  combineFriction?: (
    wheel: number,
    direction: TireFrictionDirection,
    tireFriction: number,
    body: Jolt.Body,
  ) => number;
}

export interface VehicleBuildOptions {
  hook: string;
  stateId?: number;
  position: Vec3Tuple;
  rotation: QuatTuple;
  size: { length: number; width: number; height: number };
  mass: number;
  layer: number;
  castType: VehicleCastType;
  wheelWidth: number;
  /** A cast cylinder's rounding, as a fraction of the wheel. 1 rounds it fully. */
  convexRadiusFraction?: number;
  /** Called once the chassis exists, which the core holds until release. */
  buildSettings: () => Jolt.VehicleConstraintSettings;
}

export interface VehicleDebugOverlay {
  group: Group;
  chassis: Mesh;
  wheels: Mesh[];
}

export interface Vehicle {
  body: Jolt.Body;
  constraint: Jolt.VehicleConstraint;
  geometry: BufferGeometry;
  debugView: DebugView<VehicleDebugOverlay>;
  /** Reused between calls, like the object `sync` returns. */
  state: VehicleState;
  sync: () => VehicleState;
  release: () => void;
}

const createChassis = (
  { Jolt: jolt, bodyInterface, stateIds }: JoltApi,
  { hook, stateId, position, rotation, size, mass, layer }: VehicleBuildOptions,
) => {
  const centreOfMassOffset = new jolt.Vec3(0, -size.height / 2, 0);
  const halfExtent = new jolt.Vec3(
    size.width / 2,
    size.height / 2,
    size.length / 2,
  );
  const shapeSettings = new jolt.OffsetCenterOfMassShapeSettings(
    centreOfMassOffset,
    new jolt.BoxShapeSettings(halfExtent),
  );
  jolt.destroy(halfExtent);
  jolt.destroy(centreOfMassOffset);

  const shapeResult = shapeSettings.Create();
  jolt.destroy(shapeSettings);
  const shape = shapeFromResult<Jolt.Shape>(shapeResult, hook);

  const bodyPosition = new jolt.RVec3(position[0], position[1], position[2]);
  const bodyRotation = new jolt.Quat(
    rotation[0],
    rotation[1],
    rotation[2],
    rotation[3],
  );

  const bodySettings = new jolt.BodyCreationSettings(
    shape,
    bodyPosition,
    bodyRotation,
    jolt.EMotionType_Dynamic,
    layer,
  );
  bodySettings.mOverrideMassProperties =
    jolt.EOverrideMassProperties_CalculateInertia;
  bodySettings.mMassPropertiesOverride.mMass = mass;

  shape.Release();

  const body = (() => {
    try {
      return stateIds.createBody(bodySettings, stateId, hook);
    } finally {
      jolt.destroy(bodySettings);
      jolt.destroy(bodyPosition);
      jolt.destroy(bodyRotation);
    }
  })();

  bodyInterface.AddBody(body.GetID(), jolt.EActivation_Activate);
  return body;
};

const createCollisionTester = (
  jolt: JoltApi["Jolt"],
  {
    castType,
    layer,
    wheelWidth,
    convexRadiusFraction = 0.05,
  }: VehicleBuildOptions,
) => {
  if (castType === "cylinder") {
    return new jolt.VehicleCollisionTesterCastCylinder(
      layer,
      convexRadiusFraction,
    );
  }

  return castType === "sphere"
    ? new jolt.VehicleCollisionTesterCastSphere(layer, 0.05 * wheelWidth)
    : new jolt.VehicleCollisionTesterRay(layer);
};

/**
 * The chassis, constraint, collision tester and step listener of any vehicle,
 * and their teardown. The controller is the hook's, in `buildSettings`.
 */
export const createVehicle = (
  api: JoltApi,
  scene: Scene,
  options: VehicleBuildOptions,
): Vehicle => {
  const { Jolt: jolt, bodyInterface, physicsSystem, state: world } = api;

  const body = createChassis(api, options);
  const settings = options.buildSettings();
  const wheelCount = settings.mWheels.size();

  const constraint = new jolt.VehicleConstraint(body, settings);

  // AddConstraint takes the only reference, so RemoveConstraint would delete
  // the constraint outright and a following destroy() would be a double free.
  constraint.AddRef();

  constraint.SetVehicleCollisionTester(createCollisionTester(jolt, options));
  const detach = api.constraints.attach(
    constraint,
    options.stateId,
    options.hook,
  );

  const stepListener = new jolt.VehicleConstraintStepListener(constraint);
  physicsSystem.AddStepListener(stepListener);

  const geometry = shapeToGeometry(jolt, body.GetShape());

  const wheelRight = new jolt.Vec3(0, 1, 0);
  const wheelUp = new jolt.Vec3(1, 0, 0);

  const buildDebugView = (): VehicleDebugOverlay => {
    const group = new Group();
    const chassis = new Mesh(geometry, createDebugMaterial("wheel"));
    group.add(chassis);

    const debugWheels = Array.from({ length: wheelCount }, (_, index) => {
      const wheelSettings = constraint.GetWheel(index).GetSettings();
      const debugWheel = new Mesh(
        new CylinderGeometry(
          wheelSettings.mRadius,
          wheelSettings.mRadius,
          wheelSettings.mWidth,
          8,
          1,
        ),
        createDebugMaterial("vehicle"),
      );
      group.add(debugWheel);
      return debugWheel;
    });

    syncObject(group, body);
    scene.add(group);
    return { group, chassis, wheels: debugWheels };
  };

  const releaseDebugView = ({ group, chassis, wheels }: VehicleDebugOverlay) => {
    scene.remove(group);
    disposeDebugMaterial(chassis);
    for (const debugWheel of wheels) {
      debugWheel.geometry.dispose();
      disposeDebugMaterial(debugWheel);
    }
  };

  const debugView = createDebugView(buildDebugView, releaseDebugView);

  const state: VehicleState = {
    position: new Vector3(),
    rotation: new Quaternion(),
    velocity: new Vector3(),
    wheels: Array.from({ length: wheelCount }, (_, index) => ({
      index,
      position: new Vector3(),
      rotation: new Quaternion(),
    })),
  };

  const sync = () => {
    const bodyPosition = body.GetPosition();
    const bodyRotation = body.GetRotation();
    const bodyVelocity = body.GetLinearVelocity();

    state.position.set(
      bodyPosition.GetX(),
      bodyPosition.GetY(),
      bodyPosition.GetZ(),
    );
    state.rotation.set(
      bodyRotation.GetX(),
      bodyRotation.GetY(),
      bodyRotation.GetZ(),
      bodyRotation.GetW(),
    );
    state.velocity.set(
      bodyVelocity.GetX(),
      bodyVelocity.GetY(),
      bodyVelocity.GetZ(),
    );

    for (let index = 0; index < state.wheels.length; index += 1) {
      const transform = constraint.GetWheelLocalTransform(
        index,
        wheelRight,
        wheelUp,
      );
      const translation = transform.GetTranslation();
      const wheelRotation = transform.GetRotation().GetQuaternion();
      const wheel = state.wheels[index];

      wheel.position.set(
        translation.GetX(),
        translation.GetY(),
        translation.GetZ(),
      );
      wheel.rotation.set(
        wheelRotation.GetX(),
        wheelRotation.GetY(),
        wheelRotation.GetZ(),
        wheelRotation.GetW(),
      );

      const debugWheel = debugView.current?.wheels[index];
      if (debugWheel) {
        debugWheel.position.copy(wheel.position);
        debugWheel.quaternion.copy(wheel.rotation);
      }
    }

    const debugGroup = debugView.current?.group;
    if (debugGroup) {
      debugGroup.position.copy(state.position);
      debugGroup.quaternion.copy(state.rotation);
    }

    return state;
  };

  const release = () => {
    debugView.hide();
    geometry.dispose();

    if (world.destroyed) return;

    physicsSystem.RemoveStepListener(stepListener);
    jolt.destroy(stepListener);

    detach();
    constraint.Release();

    jolt.destroy(settings);

    jolt.destroy(wheelRight);
    jolt.destroy(wheelUp);

    bodyInterface.RemoveBody(body.GetID());
    bodyInterface.DestroyBody(body.GetID());
  };

  return { body, constraint, geometry, debugView, state, sync, release };
};

/**
 * Asking for the other direction while still rolling this one means braking
 * until the vehicle stops. Which way it last went is kept in a snapshot.
 */
export const createReverseGuard = (
  api: JoltApi,
  { body, state }: Vehicle,
  stateId: number | undefined,
) => {
  let previousForward = 1;

  const stopKeeping =
    stateId === undefined
      ? () => {}
      : api.snapshots.keep({
          tag: "vehicle",
          owner: "constraint",
          id: stateId,
          save: () => [previousForward],
          restore: ([forward]) => {
            previousForward = forward;
          },
        });

  const mustBrake = (forward: number) => {
    if (previousForward * forward < 0) {
      const inverseRotation = body.GetRotation().Conjugated();
      const bodyVelocity = body.GetLinearVelocity();

      state.rotation.set(
        inverseRotation.GetX(),
        inverseRotation.GetY(),
        inverseRotation.GetZ(),
        inverseRotation.GetW(),
      );
      state.velocity.set(
        bodyVelocity.GetX(),
        bodyVelocity.GetY(),
        bodyVelocity.GetZ(),
      );

      const localVelocity = state.velocity.applyQuaternion(state.rotation).z;

      if (
        (forward > 0 && localVelocity < -0.1) ||
        (forward < 0 && localVelocity > 0.1)
      ) {
        return true;
      }
    }

    if (forward !== 0) previousForward = forward;
    return false;
  };

  return { mustBrake, stopKeeping };
};

export const setTorqueCurve = (
  engine: Jolt.VehicleEngineSettings,
  points: [rpmFraction: number, torque: number][],
  hook: string,
) => {
  if (points.length === 0) {
    console.warn(
      `[r3f-jolt] ${hook}: torqueCurve is empty, so the engine makes no torque.`,
    );
  }

  const curve = engine.mNormalizedTorque;
  curve.Clear();
  for (const [rpmFraction, torque] of points) {
    curve.AddPoint(rpmFraction, torque);
  }
  curve.Sort();
};

export const createTelemetry = (
  { state: world }: JoltApi,
  controller: {
    GetEngine: () => Jolt.VehicleEngine;
    GetTransmission: () => Jolt.VehicleTransmission;
  },
) => {
  const engine = controller.GetEngine();
  const transmission = controller.GetTransmission();
  const telemetry: VehicleTelemetry = { rpm: 0, gear: 0, ratio: 0, clutch: 0 };

  return () => {
    if (world.disposed) return telemetry;

    telemetry.rpm = engine.GetCurrentRPM();
    telemetry.gear = transmission.GetCurrentGear();
    telemetry.ratio = transmission.GetCurrentRatio();
    telemetry.clutch = transmission.GetClutchFriction();
    return telemetry;
  };
};

/** Jolt's own rule, to the bit, so a `combineFriction` that goes away changes nothing. */
const defaultCombinedFriction = (
  _wheel: number,
  _direction: TireFrictionDirection,
  tireFriction: number,
  body: Jolt.Body,
) => Math.sqrt(Math.fround(tireFriction * body.GetFriction()));

const ignoreVehicleStep = () => {};

/**
 * Installed only for a hook given the handler, because each call crosses into
 * JS: `tireGrip` per wheel per solver iteration, `combineFriction` per wheel per
 * direction per step. Destroy what this returns after the constraint.
 */
export const installTireCallbacks = (
  jolt: JoltApi["Jolt"],
  constraint: Jolt.VehicleConstraint,
  controller: Jolt.WheeledVehicleController | null,
  mount: VehicleTireOptions,
  latest: RefObject<VehicleTireOptions>,
) => {
  const installed: (
    | Jolt.WheeledVehicleControllerCallbacksJS
    | Jolt.VehicleConstraintCallbacksJS
  )[] = [];

  if (mount.tireGrip && controller) {
    const tire: TireContact = {
      wheel: 0,
      get bodyID() {
        return constraint
          .GetWheel(tire.wheel)
          .GetContactBodyID()
          .GetIndexAndSequenceNumber();
      },
      suspensionImpulse: 0,
      longitudinalFriction: 0,
      lateralFriction: 0,
      longitudinalSlip: 0,
      lateralSlip: 0,
      deltaTime: 0,
      longitudinalImpulse: 0,
      lateralImpulse: 0,
    };

    const callbacks = new jolt.WheeledVehicleControllerCallbacksJS();
    callbacks.OnTireMaxImpulseCallback = function tireMaxImpulse(
      inWheelIndex: number,
      outResult: number,
      inSuspensionImpulse: number,
      inLongitudinalFriction: number,
      inLateralFriction: number,
      inLongitudinalSlip: number,
      inLateralSlip: number,
      inDeltaTime: number,
    ) {
      tire.wheel = inWheelIndex;
      tire.suspensionImpulse = inSuspensionImpulse;
      tire.longitudinalFriction = inLongitudinalFriction;
      tire.lateralFriction = inLateralFriction;
      tire.longitudinalSlip = inLongitudinalSlip;
      tire.lateralSlip = inLateralSlip;
      tire.deltaTime = inDeltaTime;
      tire.longitudinalImpulse = inLongitudinalFriction * inSuspensionImpulse;
      tire.lateralImpulse = inLateralFriction * inSuspensionImpulse;

      latest.current.tireGrip?.(tire);

      const result = jolt.wrapPointer(
        outResult,
        jolt.TireMaxImpulseCallbackResult,
      );
      result.mLongitudinalImpulse = tire.longitudinalImpulse;
      result.mLateralImpulse = tire.lateralImpulse;
    };
    callbacks.SetWheeledVehicleController(controller);
    installed.push(callbacks);
  }

  if (mount.combineFriction) {
    const callbacks = new jolt.VehicleConstraintCallbacksJS();
    callbacks.GetCombinedFriction = function combinedFriction(
      inWheelIndex: number,
      inDirection: number,
      inTireFriction: number,
      inBody2: number,
    ) {
      const combine = latest.current.combineFriction ?? defaultCombinedFriction;
      return combine(
        inWheelIndex,
        inDirection === jolt.ETireFrictionDirection_Lateral
          ? "lateral"
          : "longitudinal",
        inTireFriction,
        jolt.wrapPointer(inBody2, jolt.Body),
      );
    };
    // JSImplementation refuses to call into an object missing any of its methods.
    callbacks.OnPreStepCallback = ignoreVehicleStep;
    callbacks.OnPostCollideCallback = ignoreVehicleStep;
    callbacks.OnPostStepCallback = ignoreVehicleStep;
    callbacks.SetVehicleConstraint(constraint);
    installed.push(callbacks);
  }

  return installed;
};

export interface BuiltVehicle<Api> {
  vehicle: Vehicle;
  api: Api;
  /** After the vehicle's own release, whether or not the world still exists. */
  release?: () => void;
}

export const useVehicle = <Options extends { debug?: boolean }, Api extends object>(
  options: Options,
  build: (
    api: JoltApi,
    scene: Scene,
    mount: Options,
    latest: RefObject<Options>,
  ) => BuiltVehicle<Api>,
) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);

  const debugViewRef = useRef<DebugView<VehicleDebugOverlay> | null>(null);
  const [vehicleApi, setVehicleApi] = useState<Api>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  const [mount] = useState(() => options);
  const latest = useHandlerRef(options);

  useEffect(() => {
    const built = build(api, scene, mount, latest);
    debugViewRef.current = built.vehicle.debugView;

    // Publishing an externally-created resource to render. The rule exempts a
    // setState whose value derives from a React ref
    // (`enableAllowSetStateFromRefsInEffects`, on by default), which is why the
    // sibling hooks are silent — they happen to publish ref-closing callbacks.
    // This one owns no ref, so the exemption does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVehicleApi(built.api);

    return () => {
      setVehicleApi(undefined);
      debugViewRef.current = null;
      built.vehicle.release();
      built.release?.();
    };
  }, [api, build, latest, mount, scene]);

  const debug = useDebugFlag(mount.debug);
  useDebugView(vehicleApi, debugViewRef, debug);

  return vehicleApi;
};
