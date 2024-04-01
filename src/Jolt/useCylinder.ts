import { useCallback, useEffect, useRef, useState } from "react";
import { useJolt } from "./useJolt";
import {
  BufferGeometry,
  CylinderGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  NormalBufferAttributes,
  Object3DEventMap,
  Quaternion,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import Jolt from "jolt-physics";

export const useCylinder = ({
  height,
  radius,
  position,
  rotation = [0, 0, 0, 1],
  motionType,
  debug = false,
  mass = 1000,
  material,
  initialVelocity,
  bodySettingsOverride,
}: {
  height: number;
  radius: number;
  position: [number, number, number];
  rotation?: [number, number, number, number];
  motionType: "static" | "dynamic";
  debug?: boolean;
  mass?: number;
  material?: {
    friction?: number;
    restitution?: number;
  };
  initialVelocity?: [number, number, number];
  bodySettingsOverride?: (settings: Jolt.BodyCreationSettings) => void;
}) => {
  const ref = useRef<Mesh>(null);

  const { Jolt, bodyInterface, layers } = useJolt();
  const scene = useThree((state) => state.scene);

  const [api, setApi] = useState<{
    body: Jolt.Body;
    shape: Jolt.CylinderShape;
    debugMesh: Mesh<
      BufferGeometry<NormalBufferAttributes>,
      Material | Material[],
      Object3DEventMap
    > | null;
  }>();

  const init = useCallback(() => {
    const shape = new Jolt.CylinderShape(height * 0.5, radius, 0.05, undefined);

    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.Vec3(position[0], position[1], position[2]),
      new Jolt.Quat(rotation[0], rotation[1], rotation[2], rotation[3]),
      motionType === "dynamic"
        ? Jolt.EMotionType_Dynamic
        : Jolt.EMotionType_Static,
      motionType === "dynamic" ? layers.LAYER_MOVING : layers.LAYER_NON_MOVING
    );

    if (bodySettingsOverride) {
      bodySettingsOverride(bodySettings);
    }

    const body = bodyInterface.CreateBody(bodySettings);

    body.GetMotionProperties().SetInverseMass(1 / mass);

    if (material?.friction) {
      body.SetFriction(material.friction);
    }

    if (material?.restitution) {
      body.SetRestitution(material.restitution);
    }

    if (initialVelocity) {
      body.SetLinearVelocity(
        new Jolt.Vec3(
          initialVelocity[0],
          initialVelocity[1],
          initialVelocity[2]
        )
      );
    }

    Jolt.destroy(bodySettings);

    bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);

    let debugMesh: Mesh | null = null;

    if (debug) {
      const cylinderShape = Jolt.castObject(shape, Jolt.CylinderShape);
      const cylinderRadius = cylinderShape.GetRadius();
      const halfHeight = cylinderShape.GetHalfHeight();
      const cylinder = new CylinderGeometry(
        cylinderRadius,
        cylinderRadius,
        halfHeight * 2,
        32
      );
      const cylinderMesh = new Mesh(
        cylinder,
        new MeshBasicMaterial({ color: "green", wireframe: true })
      );
      debugMesh = cylinderMesh;
      scene.add(cylinderMesh);
    }

    return {
      api: { body, shape, debugMesh },
      cleanup: () => {
        bodyInterface.RemoveBody(body.GetID());
        bodyInterface.DestroyBody(body.GetID());
        if (debugMesh) {
          scene.remove(debugMesh);
          debugMesh.geometry.dispose();
          if (debugMesh.material instanceof MeshBasicMaterial) {
            debugMesh.material.dispose();
          }
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

  useFrame(() => {
    if (!api) return;

    if (ref.current) {
      ref.current.position.copy(
        new Vector3(
          api.body.GetPosition().GetX(),
          api.body.GetPosition().GetY(),
          api.body.GetPosition().GetZ()
        )
      );

      ref.current.quaternion.copy(
        new Quaternion(
          api.body.GetRotation().GetX(),
          api.body.GetRotation().GetY(),
          api.body.GetRotation().GetZ(),
          api.body.GetRotation().GetW()
        )
      );
    }

    if (api.debugMesh) {
      api.debugMesh.position.copy(
        new Vector3(
          api.body.GetPosition().GetX(),
          api.body.GetPosition().GetY(),
          api.body.GetPosition().GetZ()
        )
      );

      api.debugMesh.quaternion.copy(
        new Quaternion(
          api.body.GetRotation().GetX(),
          api.body.GetRotation().GetY(),
          api.body.GetRotation().GetZ(),
          api.body.GetRotation().GetW()
        )
      );
    }
  });

  return [ref, api] as [
    React.RefObject<
      Mesh<
        BufferGeometry<NormalBufferAttributes>,
        Material | Material[],
        Object3DEventMap
      >
    >,
    {
      body: Jolt.Body;
      shape: Jolt.CylinderShape;
      debugMesh: Mesh<
        BufferGeometry<NormalBufferAttributes>,
        Material | Material[],
        Object3DEventMap
      > | null;
    }
  ];
};
