import { useEffect, useMemo, useRef } from "react";
import { useJolt } from "./useJolt";
import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";

export const useCylinder = ({
  height,
  radius,
  position,
  rotation = [0, 0, 0, 1],
  motionType,
  debug = false,
  material,
}: {
  height: number;
  radius: number;
  position: [number, number, number];
  rotation?: [number, number, number, number];
  motionType: "static" | "dynamic";
  debug?: boolean;
  material?: {
    friction?: number;
    restitution?: number;
  };
}) => {
  const ref = useRef<Mesh>(null);

  const { Jolt, bodyInterface, layers } = useJolt();
  const { scene } = useThree();

  const api = useMemo(() => {
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

    const body = bodyInterface.CreateBody(bodySettings);

    if (material?.friction) {
      body.SetFriction(material.friction);
    }

    if (material?.restitution) {
      body.SetRestitution(material.restitution);
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
        new MeshBasicMaterial({ color: 0x00ff00, wireframe: true })
      );
      debugMesh = cylinderMesh;
      scene.add(cylinderMesh);
    }

    return { body, shape, debugMesh };
  }, [
    Jolt,
    bodyInterface,
    height,
    radius,
    layers,
    material,
    motionType,
    position,
    rotation,
    debug,
    scene,
  ]);

  useFrame(() => {
    if (!api.body) return;

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

  useEffect(() => {
    return () => {
      bodyInterface.RemoveBody(api.body.GetID());
      bodyInterface.DestroyBody(api.body.GetID());
      Jolt.destroy(api.body);
      Jolt.destroy(api.shape);
      if (api.debugMesh) {
        scene.remove(api.debugMesh);
        api.debugMesh.geometry.dispose();
        if (api.debugMesh.material instanceof MeshBasicMaterial) {
          api.debugMesh.material.dispose();
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, api] as const;
};
