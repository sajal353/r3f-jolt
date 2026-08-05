import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Quaternion,
  Vector3,
} from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import {
  createDebugMaterial,
  disposeDebugMaterial,
} from "./internal/debugMaterial";
import { shapeFromResult } from "./internal/useBody";
import type { QuatTuple, Vec3Tuple } from "./types";

export interface CarInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  modifier: boolean;
}

export interface CarWheelState {
  index: number;
  position: Vector3;
  rotation: Quaternion;
}

export interface CarState {
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  wheels: CarWheelState[];
}

export interface UseCarOptions {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  castType?: "cylinder" | "sphere" | "ray";
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
  debugGroup: Group | null;
  geometry: BufferGeometry;
}

const FL_WHEEL = 0;
const FR_WHEEL = 1;
const BL_WHEEL = 2;
const BR_WHEEL = 3;

export const useCar = (options: UseCarOptions) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);

  const [carApi, setCarApi] = useState<CarApi>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  const [mount] = useState(() => options);

  useEffect(() => {
    const {
      Jolt: jolt,
      bodyInterface,
      physicsSystem,
      layers,
      state,
      debug: debugDefault,
    } = api;

    const {
      position,
      rotation = [0, 0, 0, 1],
      castType = "cylinder",
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
      mass = 1500,
      maxTorque = 500,
      clutchStrength = 10,
      debug = debugDefault,
      layer = layers.LAYER_MOVING,
    } = mount;

    const centreOfMassOffset = new jolt.Vec3(0, -vehicleSize.height / 2, 0);
    const halfExtent = new jolt.Vec3(
      vehicleSize.width / 2,
      vehicleSize.height / 2,
      vehicleSize.length / 2,
    );
    const carShapeSettings = new jolt.OffsetCenterOfMassShapeSettings(
      centreOfMassOffset,
      new jolt.BoxShapeSettings(halfExtent),
    );
    jolt.destroy(halfExtent);
    jolt.destroy(centreOfMassOffset);

    const shapeResult = carShapeSettings.Create();
    jolt.destroy(carShapeSettings);
    const carShape = shapeFromResult<Jolt.Shape>(shapeResult, "useCar");

    const bodyPosition = new jolt.RVec3(position[0], position[1], position[2]);
    const bodyRotation = new jolt.Quat(
      rotation[0],
      rotation[1],
      rotation[2],
      rotation[3],
    );

    const carBodySettings = new jolt.BodyCreationSettings(
      carShape,
      bodyPosition,
      bodyRotation,
      jolt.EMotionType_Dynamic,
      layer,
    );
    carBodySettings.mOverrideMassProperties =
      jolt.EOverrideMassProperties_CalculateInertia;
    carBodySettings.mMassPropertiesOverride.mMass = mass;

    carShape.Release();

    const carBody = bodyInterface.CreateBody(carBodySettings);

    jolt.destroy(carBodySettings);
    jolt.destroy(bodyPosition);
    jolt.destroy(bodyRotation);

    bodyInterface.AddBody(carBody.GetID(), jolt.EActivation_Activate);

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

    const wheels: Jolt.WheelSettingsWV[] = [];

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
      wheels.push(wheel);
    }

    const controllerSettings = new jolt.WheeledVehicleControllerSettings();
    controllerSettings.mEngine.mMaxTorque = maxTorque;
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

    controllerSettings.mDifferentialLimitedSlipRatio =
      frontBackLimitedSlipRatio;
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

    const constraint = new jolt.VehicleConstraint(carBody, vehicleSettings);

    // AddConstraint takes the only reference, so RemoveConstraint would delete
    // the constraint outright and a following destroy() would be a double free.
    constraint.AddRef();

    const collisionTester =
      castType === "cylinder"
        ? new jolt.VehicleCollisionTesterCastCylinder(layer, 0.05)
        : castType === "sphere"
          ? new jolt.VehicleCollisionTesterCastSphere(
              layer,
              0.05 * wheelSettings.width,
            )
          : new jolt.VehicleCollisionTesterRay(layer);

    constraint.SetVehicleCollisionTester(collisionTester);
    physicsSystem.AddConstraint(constraint);

    const stepListener = new jolt.VehicleConstraintStepListener(constraint);
    physicsSystem.AddStepListener(stepListener);

    const controller = jolt.castObject(
      constraint.GetController(),
      jolt.WheeledVehicleController,
    );

    const geometry = shapeToGeometry(jolt, carBody.GetShape());

    const wheelRight = new jolt.Vec3(0, 1, 0);
    const wheelUp = new jolt.Vec3(1, 0, 0);

    let debugGroup: Group | null = null;
    const debugWheels: Mesh[] = [];

    if (debug) {
      debugGroup = new Group();
      debugGroup.add(new Mesh(geometry, createDebugMaterial("wheel")));

      for (let index = 0; index < wheels.length; index += 1) {
        const settings = constraint.GetWheel(index).GetSettings();
        const debugWheel = new Mesh(
          new CylinderGeometry(
            settings.mRadius,
            settings.mRadius,
            settings.mWidth,
            8,
            1,
          ),
          createDebugMaterial("vehicle"),
        );

        debugGroup.add(debugWheel);
        debugWheels.push(debugWheel);
      }

      scene.add(debugGroup);
    }

    const carState: CarState = {
      position: new Vector3(),
      rotation: new Quaternion(),
      velocity: new Vector3(),
      wheels: wheels.map((_, index) => ({
        index,
        position: new Vector3(),
        rotation: new Quaternion(),
      })),
    };

    let previousForward = 1;

    const update = (input: CarInput): CarState => {
      if (state.disposed) return carState;

      let forward = input.forward ? 1 : input.backward ? -1 : 0;
      const right = input.right ? 1 : input.left ? -1 : 0;
      let brake = 0;
      let handbrake = 0;

      if (previousForward * forward < 0) {
        const bodyRotation = carBody.GetRotation().Conjugated();
        const bodyVelocity = carBody.GetLinearVelocity();

        carState.rotation.set(
          bodyRotation.GetX(),
          bodyRotation.GetY(),
          bodyRotation.GetZ(),
          bodyRotation.GetW(),
        );
        carState.velocity.set(
          bodyVelocity.GetX(),
          bodyVelocity.GetY(),
          bodyVelocity.GetZ(),
        );

        const localVelocity = carState.velocity.applyQuaternion(
          carState.rotation,
        ).z;

        if (
          (forward > 0 && localVelocity < -0.1) ||
          (forward < 0 && localVelocity > 0.1)
        ) {
          forward = 0;
          brake = 1;
        }
      }

      previousForward = forward !== 0 ? forward : previousForward;

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

      const bodyPosition = carBody.GetPosition();
      const bodyRotation = carBody.GetRotation();
      const bodyVelocity = carBody.GetLinearVelocity();

      carState.position.set(
        bodyPosition.GetX(),
        bodyPosition.GetY(),
        bodyPosition.GetZ(),
      );
      carState.rotation.set(
        bodyRotation.GetX(),
        bodyRotation.GetY(),
        bodyRotation.GetZ(),
        bodyRotation.GetW(),
      );
      carState.velocity.set(
        bodyVelocity.GetX(),
        bodyVelocity.GetY(),
        bodyVelocity.GetZ(),
      );

      for (let index = 0; index < carState.wheels.length; index += 1) {
        const transform = constraint.GetWheelLocalTransform(
          index,
          wheelRight,
          wheelUp,
        );
        const translation = transform.GetTranslation();
        const wheelRotation = transform.GetRotation().GetQuaternion();
        const wheel = carState.wheels[index];

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

        const debugWheel = debugWheels[index];
        if (debugWheel) {
          debugWheel.position.copy(wheel.position);
          debugWheel.quaternion.copy(wheel.rotation);
        }
      }

      if (debugGroup) {
        debugGroup.position.copy(carState.position);
        debugGroup.quaternion.copy(carState.rotation);
      }

      return carState;
    };

    // Publishing an externally-created resource to render. The rule exempts a
    // setState whose value derives from a React ref
    // (`enableAllowSetStateFromRefsInEffects`, on by default), which is why the
    // sibling hooks are silent — they happen to publish ref-closing callbacks.
    // This one owns no ref, so the exemption does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCarApi({ carBody, constraint, update, debugGroup, geometry });

    return () => {
      setCarApi(undefined);

      if (debugGroup) {
        scene.remove(debugGroup);
        for (const debugWheel of debugWheels) {
          debugWheel.geometry.dispose();
          disposeDebugMaterial(debugWheel);
        }
        for (const child of debugGroup.children) {
          if (child instanceof Mesh && child.geometry === geometry) {
            disposeDebugMaterial(child);
          }
        }
      }

      geometry.dispose();

      if (state.destroyed) return;

      physicsSystem.RemoveStepListener(stepListener);
      jolt.destroy(stepListener);

      physicsSystem.RemoveConstraint(constraint);
      constraint.Release();

      jolt.destroy(vehicleSettings);

      jolt.destroy(wheelRight);
      jolt.destroy(wheelUp);

      bodyInterface.RemoveBody(carBody.GetID());
      bodyInterface.DestroyBody(carBody.GetID());
    };
  }, [api, mount, scene]);

  return [carApi] as [CarApi | undefined];
};
