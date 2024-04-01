import { useCallback, useEffect, useState } from "react";
import { useJolt } from "./useJolt";
import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBufferAttributes,
  Quaternion,
  Vector3,
} from "three";
import Jolt from "jolt-physics";
import { useThree } from "@react-three/fiber";

export const useCar = ({
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
  mass = 1500,
  maxTorque = 500,
  clutchStrength = 10,
  debug = false,
}: {
  position: [number, number, number];
  rotation?: [number, number, number, number];
  castType?: "cylinder" | "sphere" | undefined;
  wheelSettings: {
    radius: number;
    width: number;
    offsetHorizontal: number;
    offsetVertical: number;
  };
  vehicleSize: {
    length: number;
    width: number;
    height: number;
  };
  suspension?: {
    minLength: number;
    maxLength: number;
  };
  maxSteerAngle?: number;
  maxPitchRollAngle?: number;
  driveType?: "rwd" | "fwd" | "awd";
  frontBackLimitedSlipRatio?: number;
  leftRightLimitedSlipRatio?: number;
  antiRollbar?: boolean;
  mass?: number;
  maxTorque?: number;
  clutchStrength?: number;
  debug?: boolean;
}) => {
  const { Jolt, bodyInterface, physicsSystem, layers } = useJolt();
  const scene = useThree((state) => state.scene);

  const [api, setApi] = useState<{
    carBody: Jolt.Body;
    update: (input: {
      forward: boolean;
      backward: boolean;
      left: boolean;
      right: boolean;
      handbrake: boolean;
      modifier: boolean;
    }) => {
      position: Vector3;
      rotation: Quaternion;
      velocity: Vector3;
      wheels: {
        index: number;
        position: Vector3;
        rotation: Quaternion;
      }[];
    };
    debugGroup: Group | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
  }>();

  const init = useCallback(() => {
    const carShapeSettings = new Jolt.OffsetCenterOfMassShapeSettings(
      new Jolt.Vec3(0, -vehicleSize.height / 2, 0),
      new Jolt.BoxShapeSettings(
        new Jolt.Vec3(
          vehicleSize.width / 2,
          vehicleSize.height / 2,
          vehicleSize.length / 2
        )
      )
    );

    const carShape = carShapeSettings.Create().Get();

    const carBodySettings = new Jolt.BodyCreationSettings(
      carShape,
      new Jolt.Vec3(position[0], position[1], position[2]),
      new Jolt.Quat(rotation[0], rotation[1], rotation[2], rotation[3]),
      Jolt.EMotionType_Dynamic,
      layers.LAYER_MOVING
    );

    carBodySettings.mOverrideMassProperties =
      Jolt.EOverrideMassProperties_CalculateInertia;
    carBodySettings.mMassPropertiesOverride.mMass = mass;

    const carBody = bodyInterface.CreateBody(carBodySettings);

    bodyInterface.AddBody(carBody.GetID(), Jolt.EActivation_Activate);

    const vehicle = new Jolt.VehicleConstraintSettings();
    vehicle.mMaxPitchRollAngle = maxPitchRollAngle * (Math.PI / 180);
    vehicle.mWheels.clear();

    const FL_WHEEL = 0;
    const FR_WHEEL = 1;
    const BL_WHEEL = 2;
    const BR_WHEEL = 3;

    const mWheels: Jolt.WheelSettingsWV[] = [];

    const forwardLeftWheel = new Jolt.WheelSettingsWV();
    forwardLeftWheel.mPosition = new Jolt.Vec3(
      vehicleSize.width / 2,
      -wheelSettings.offsetVertical,
      wheelSettings.offsetHorizontal
    );
    forwardLeftWheel.mMaxSteerAngle = maxSteerAngle * (Math.PI / 180);
    if (driveType === "rwd") {
      forwardLeftWheel.mMaxHandBrakeTorque = 0;
    }
    if (driveType === "fwd") {
      forwardLeftWheel.mMaxBrakeTorque = 0;
    }
    vehicle.mWheels.push_back(forwardLeftWheel);
    mWheels.push(forwardLeftWheel);

    const forwardRightWheel = new Jolt.WheelSettingsWV();
    forwardRightWheel.mPosition = new Jolt.Vec3(
      -vehicleSize.width / 2,
      -wheelSettings.offsetVertical,
      wheelSettings.offsetHorizontal
    );
    forwardRightWheel.mMaxSteerAngle = maxSteerAngle * (Math.PI / 180);
    if (driveType === "rwd") {
      forwardRightWheel.mMaxHandBrakeTorque = 0;
    }
    if (driveType === "fwd") {
      forwardRightWheel.mMaxBrakeTorque = 0;
    }
    vehicle.mWheels.push_back(forwardRightWheel);
    mWheels.push(forwardRightWheel);

    const backLeftWheel = new Jolt.WheelSettingsWV();
    backLeftWheel.mPosition = new Jolt.Vec3(
      vehicleSize.width / 2,
      -wheelSettings.offsetVertical,
      -wheelSettings.offsetHorizontal
    );
    backLeftWheel.mMaxSteerAngle = 0;
    if (driveType === "rwd") {
      forwardRightWheel.mMaxBrakeTorque = 0;
    }
    if (driveType === "fwd") {
      forwardRightWheel.mMaxHandBrakeTorque = 0;
    }
    vehicle.mWheels.push_back(backLeftWheel);
    mWheels.push(backLeftWheel);

    const backRightWheel = new Jolt.WheelSettingsWV();
    backRightWheel.mPosition = new Jolt.Vec3(
      -vehicleSize.width / 2,
      -wheelSettings.offsetVertical,
      -wheelSettings.offsetHorizontal
    );
    backRightWheel.mMaxSteerAngle = 0;
    if (driveType === "rwd") {
      forwardRightWheel.mMaxBrakeTorque = 0;
    }
    if (driveType === "fwd") {
      forwardRightWheel.mMaxHandBrakeTorque = 0;
    }
    vehicle.mWheels.push_back(backRightWheel);
    mWheels.push(backRightWheel);

    mWheels.forEach((wheel) => {
      wheel.mRadius = wheelSettings.radius;
      wheel.mWidth = wheelSettings.width;
      wheel.mSuspensionMinLength = suspension.minLength;
      wheel.mSuspensionMaxLength = suspension.maxLength;
    });

    const controllerSettings = new Jolt.WheeledVehicleControllerSettings();
    controllerSettings.mEngine.mMaxTorque = maxTorque;
    controllerSettings.mTransmission.mClutchStrength = clutchStrength;
    vehicle.mController = controllerSettings;

    controllerSettings.mDifferentials.clear();

    if (driveType === "awd") {
      const rearWheelDrive = new Jolt.VehicleDifferentialSettings();
      rearWheelDrive.mLeftWheel = BL_WHEEL;
      rearWheelDrive.mRightWheel = BR_WHEEL;
      rearWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
      rearWheelDrive.mEngineTorqueRatio = 0.5;
      controllerSettings.mDifferentials.push_back(rearWheelDrive);

      const frontWheelDrive = new Jolt.VehicleDifferentialSettings();
      frontWheelDrive.mLeftWheel = FL_WHEEL;
      frontWheelDrive.mRightWheel = FR_WHEEL;
      frontWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
      frontWheelDrive.mEngineTorqueRatio = 0.5;
      controllerSettings.mDifferentials.push_back(frontWheelDrive);
    } else if (driveType === "fwd") {
      const frontWheelDrive = new Jolt.VehicleDifferentialSettings();
      frontWheelDrive.mLeftWheel = FL_WHEEL;
      frontWheelDrive.mRightWheel = FR_WHEEL;
      frontWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
      frontWheelDrive.mEngineTorqueRatio = 1;
      controllerSettings.mDifferentials.push_back(frontWheelDrive);
    } else {
      const rearWheelDrive = new Jolt.VehicleDifferentialSettings();
      rearWheelDrive.mLeftWheel = BL_WHEEL;
      rearWheelDrive.mRightWheel = BR_WHEEL;
      rearWheelDrive.mLimitedSlipRatio = leftRightLimitedSlipRatio;
      rearWheelDrive.mEngineTorqueRatio = 1;
      controllerSettings.mDifferentials.push_back(rearWheelDrive);
    }

    controllerSettings.mDifferentialLimitedSlipRatio =
      frontBackLimitedSlipRatio;

    if (antiRollbar) {
      vehicle.mAntiRollBars.clear();
      const frontAntiRollBar = new Jolt.VehicleAntiRollBar();
      frontAntiRollBar.mLeftWheel = FL_WHEEL;
      frontAntiRollBar.mRightWheel = FR_WHEEL;
      const rearAntiRollBar = new Jolt.VehicleAntiRollBar();
      rearAntiRollBar.mLeftWheel = BL_WHEEL;
      rearAntiRollBar.mRightWheel = BR_WHEEL;
      vehicle.mAntiRollBars.push_back(frontAntiRollBar);
      vehicle.mAntiRollBars.push_back(rearAntiRollBar);
    }

    const vehicleConstraint = new Jolt.VehicleConstraint(carBody, vehicle);

    if (castType === "cylinder") {
      vehicleConstraint.SetVehicleCollisionTester(
        new Jolt.VehicleCollisionTesterCastCylinder(layers.LAYER_MOVING, 0.05)
      );
    } else if (castType === "sphere") {
      vehicleConstraint.SetVehicleCollisionTester(
        new Jolt.VehicleCollisionTesterCastSphere(
          layers.LAYER_MOVING,
          0.05 * wheelSettings.width
        )
      );
    } else {
      vehicleConstraint.SetVehicleCollisionTester(
        new Jolt.VehicleCollisionTesterRay(layers.LAYER_MOVING)
      );
    }

    physicsSystem.AddConstraint(vehicleConstraint);

    const controller = Jolt.castObject(
      vehicleConstraint.GetController(),
      Jolt.WheeledVehicleController
    );

    let debugGroup: Group | null = null;
    const debugWheels: Mesh[] = [];

    const shape = carBody.GetShape();
    const meshShape = Jolt.castObject(shape, Jolt.MeshShape);
    const shapeScale = new Jolt.Vec3(1, 1, 1);
    const geometryTris = new Jolt.ShapeGetTriangles(
      meshShape,
      Jolt.AABox.prototype.sBiggest(),
      shape.GetCenterOfMass(),
      Jolt.Quat.prototype.sIdentity(),
      shapeScale
    );
    Jolt.destroy(shapeScale);
    const geometryVertices = new Float32Array(
      Jolt.HEAPF32.buffer,
      geometryTris.GetVerticesData(),
      geometryTris.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT
    );
    const buffer = new BufferAttribute(geometryVertices, 3).clone();
    Jolt.destroy(geometryTris);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", buffer);
    geometry.computeVertexNormals();

    if (debug) {
      debugGroup = new Group();

      const carBodyDebugMesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: "lawngreen", wireframe: true })
      );

      debugGroup.add(carBodyDebugMesh);

      for (let i = 0; i < mWheels.length; i++) {
        const debugWheel = vehicleConstraint.GetWheel(i);
        const debugWheelSetting = debugWheel.GetSettings();

        const debugWheelMesh = new Mesh(
          new CylinderGeometry(
            debugWheelSetting.mRadius,
            debugWheelSetting.mRadius,
            debugWheelSetting.mWidth,
            8,
            1
          ),
          new MeshBasicMaterial({ color: "mediumslateblue", wireframe: true })
        );

        const wheelTransform = vehicleConstraint.GetWheelLocalTransform(
          i,
          new Jolt.Vec3(0, 1, 0),
          new Jolt.Vec3(1, 0, 0)
        );

        debugWheelMesh.position.set(
          wheelTransform.GetTranslation().GetX(),
          wheelTransform.GetTranslation().GetY(),
          wheelTransform.GetTranslation().GetZ()
        );

        debugWheelMesh.quaternion.set(
          wheelTransform.GetRotation().GetQuaternion().GetX(),
          wheelTransform.GetRotation().GetQuaternion().GetY(),
          wheelTransform.GetRotation().GetQuaternion().GetZ(),
          wheelTransform.GetRotation().GetQuaternion().GetW()
        );

        debugGroup.add(debugWheelMesh);

        debugWheels.push(debugWheelMesh);
      }

      scene.add(debugGroup);
    }

    let previousForward = 0.0;

    const update = (input: {
      forward: boolean;
      backward: boolean;
      left: boolean;
      right: boolean;
      handbrake: boolean;
      modifier: boolean;
    }) => {
      let forward = 0;
      let right = 0;
      let brake = 0;
      let handbrake = 0.0;

      forward = input.forward ? 1 : input.backward ? -1 : 0;
      right = input.right ? 1 : input.left ? -1 : 0;

      if (previousForward * forward < 0) {
        const carRotation = carBody.GetRotation().Conjugated();
        const rotation = new Quaternion(
          carRotation.GetX(),
          carRotation.GetY(),
          carRotation.GetZ(),
          carRotation.GetW()
        );
        const carLinearVelocity = carBody.GetLinearVelocity();
        const linearVelocity = new Vector3(
          carLinearVelocity.GetX(),
          carLinearVelocity.GetY(),
          carLinearVelocity.GetZ()
        );
        const velocity = linearVelocity.applyQuaternion(rotation).z;

        if (
          (forward > 0 && velocity < -0.1) ||
          (forward < 0.0 && velocity > 0.1)
        ) {
          forward = 0;
          brake = 1;
        } else {
          previousForward = forward;
        }
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

      const car = {
        position: new Vector3(
          carBody.GetPosition().GetX(),
          carBody.GetPosition().GetY(),
          carBody.GetPosition().GetZ()
        ),
        rotation: new Quaternion(
          carBody.GetRotation().GetX(),
          carBody.GetRotation().GetY(),
          carBody.GetRotation().GetZ(),
          carBody.GetRotation().GetW()
        ),
        velocity: new Vector3(
          carBody.GetLinearVelocity().GetX(),
          carBody.GetLinearVelocity().GetY(),
          carBody.GetLinearVelocity().GetZ()
        ),
        wheels: mWheels.map((_, i) => {
          const wheelTransform = vehicleConstraint.GetWheelLocalTransform(
            i,
            new Jolt.Vec3(0, 1, 0),
            new Jolt.Vec3(1, 0, 0)
          );
          return {
            index: i,
            position: new Vector3(
              wheelTransform.GetTranslation().GetX(),
              wheelTransform.GetTranslation().GetY(),
              wheelTransform.GetTranslation().GetZ()
            ),
            rotation: new Quaternion(
              wheelTransform.GetRotation().GetQuaternion().GetX(),
              wheelTransform.GetRotation().GetQuaternion().GetY(),
              wheelTransform.GetRotation().GetQuaternion().GetZ(),
              wheelTransform.GetRotation().GetQuaternion().GetW()
            ),
          };
        }),
      };

      if (debug && debugGroup) {
        debugGroup.position.set(car.position.x, car.position.y, car.position.z);
        debugGroup.quaternion.set(
          car.rotation.x,
          car.rotation.y,
          car.rotation.z,
          car.rotation.w
        );

        for (let i = 0; i < debugWheels.length; i++) {
          const wheel = car.wheels[i];
          debugWheels[i].position.set(
            wheel.position.x,
            wheel.position.y,
            wheel.position.z
          );
          debugWheels[i].quaternion.set(
            wheel.rotation.x,
            wheel.rotation.y,
            wheel.rotation.z,
            wheel.rotation.w
          );
        }
      }

      return car;
    };

    physicsSystem.AddStepListener(
      new Jolt.VehicleConstraintStepListener(vehicleConstraint)
    );

    return {
      api: {
        carBody,
        update,
        debugGroup,
        geometry,
      },
      cleanup: () => {
        // bodyInterface.RemoveBody(carBody.GetID());
        Jolt.destroy(carShapeSettings);
        Jolt.destroy(carBodySettings);
        Jolt.destroy(vehicle);
        if (debugGroup) {
          scene.remove(debugGroup);
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { api, cleanup } = init();
    setApi(api);
    return cleanup;
  }, [init]);

  return [api] as [
    {
      carBody: Jolt.Body;
      update: (input: {
        forward: boolean;
        backward: boolean;
        left: boolean;
        right: boolean;
        handbrake: boolean;
        modifier: boolean;
      }) => {
        position: Vector3;
        rotation: Quaternion;
        velocity: Vector3;
        wheels: {
          index: number;
          position: Vector3;
          rotation: Quaternion;
        }[];
      };
      debugGroup: Group | null;
      geometry: BufferGeometry<NormalBufferAttributes>;
    }
  ];
};
