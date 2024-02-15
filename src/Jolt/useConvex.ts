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

export const useConvex = ({
  vertices,
  position,
  rotation = [0, 0, 0, 1],
  motionType,
  debug = false,
  mass = 1000,
  material,
}: {
  vertices: number[][];
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
    const hull = new Jolt.ConvexHullShapeSettings();

    for (let i = 0; i < vertices.length; i++) {
      hull.mPoints.push_back(
        new Jolt.Vec3(vertices[i][0], vertices[i][1], vertices[i][2])
      );
    }

    const shape = hull.Create().Get();
    Jolt.destroy(hull);

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
      const meshMesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: "magenta", wireframe: true })
      );
      debugMesh = meshMesh;
      scene.add(meshMesh);
    }

    return { body, shape, debugMesh, geometry };
  }, [
    Jolt,
    bodyInterface,
    vertices,
    layers,
    material,
    position,
    rotation,
    mass,
    debug,
    scene,
    motionType,
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
