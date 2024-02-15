import { useEffect, useMemo, useRef } from "react";
import { useJolt } from "./useJolt";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";

export const useTaperedCapsule = ({
  topRadius,
  bottomRadius,
  height,
  position,
  rotation = [0, 0, 0, 1],
  motionType,
  debug = false,
  mass = 1000,
  material,
}: {
  topRadius: number;
  bottomRadius: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number, number];
  motionType: "static" | "dynamic";
  debug?: boolean;
  mass?: number;
  material?: {
    friction?: number;
    restitution?: number;
  };
}) => {
  const ref = useRef<Mesh>(null);

  const { Jolt, bodyInterface, layers } = useJolt();
  const { scene } = useThree();

  const api = useMemo(() => {
    const shape = new Jolt.TaperedCapsuleShapeSettings(
      height * 0.5,
      topRadius,
      bottomRadius,
      undefined
    )
      .Create()
      .Get();
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

    body.GetMotionProperties().SetInverseMass(1 / mass);

    if (material?.friction) {
      body.SetFriction(material.friction);
    }

    if (material?.restitution) {
      body.SetRestitution(material.restitution);
    }

    Jolt.destroy(bodySettings);

    bodyInterface.AddBody(body.GetID(), Jolt.EActivation_Activate);

    let debugMesh: Mesh | null = null;

    const taperedCapsuleShape = Jolt.castObject(
      shape,
      Jolt.TaperedCapsuleShape
    );
    const shapeScale = new Jolt.Vec3(1, 1, 1);
    const tris = new Jolt.ShapeGetTriangles(
      taperedCapsuleShape,
      Jolt.AABox.prototype.sBiggest(),
      shape.GetCenterOfMass(),
      Jolt.Quat.prototype.sIdentity(),
      shapeScale
    );
    Jolt.destroy(shapeScale);
    const vertices = new Float32Array(
      Jolt.HEAPF32.buffer,
      tris.GetVerticesData(),
      tris.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT
    );
    const buffer = new BufferAttribute(vertices, 3).clone();
    Jolt.destroy(tris);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", buffer);
    geometry.computeVertexNormals();

    if (debug) {
      const taperedCapsuleMesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: "orange", wireframe: true })
      );
      debugMesh = taperedCapsuleMesh;
      scene.add(taperedCapsuleMesh);
    }

    return { body, shape, debugMesh, geometry };
  }, [
    Jolt,
    bodyInterface,
    height,
    topRadius,
    bottomRadius,
    layers,
    mass,
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
