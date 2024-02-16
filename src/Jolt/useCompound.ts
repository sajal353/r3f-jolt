import { useEffect, useMemo, useRef } from "react";
import { useJolt } from "./useJolt";
import {
  BufferAttribute,
  BufferGeometry,
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

export const useCompound = ({
  shapes,
  position,
  rotation = [0, 0, 0, 1],
  motionType,
  debug = false,
  mass = 1000,
  material,
}: {
  shapes: {
    type:
      | "box"
      | "capsule"
      | "cylinder"
      | "sphere"
      | "taperedCapsule"
      | "convex";
    position: [number, number, number];
    rotation?: [number, number, number, number];
    size?: [number, number, number];
    height?: number;
    radius?: number;
    topRadius?: number;
    bottomRadius?: number;
    vertices?: number[][];
  }[];
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
    const compound = new Jolt.StaticCompoundShapeSettings();

    for (const shape of shapes) {
      const position = new Jolt.Vec3(
        shape.position[0],
        shape.position[1],
        shape.position[2]
      );
      const rotation = shape.rotation
        ? new Jolt.Quat(
            shape.rotation[0],
            shape.rotation[1],
            shape.rotation[2],
            shape.rotation[3]
          )
        : new Jolt.Quat(0, 0, 0, 1);

      let shapeSettings;

      switch (shape.type) {
        case "box":
          if (!shape.size) {
            console.error("Size is required for box shape");
            break;
          }
          shapeSettings = new Jolt.BoxShapeSettings(
            new Jolt.Vec3(
              shape.size[0] * 0.5,
              shape.size[1] * 0.5,
              shape.size[2] * 0.5
            ),
            0.05,
            undefined
          );
          break;
        case "capsule":
          if (!shape.height || !shape.radius) {
            console.error("Height and radius are required for capsule shape");
            break;
          }
          shapeSettings = new Jolt.CapsuleShapeSettings(
            shape.height * 0.5,
            shape.radius,
            undefined
          );
          break;
        case "cylinder":
          if (!shape.height || !shape.radius) {
            console.error("Height and radius are required for cylinder shape");
            break;
          }
          shapeSettings = new Jolt.CylinderShapeSettings(
            shape.height * 0.5,
            shape.radius,
            0.05,
            undefined
          );
          break;
        case "sphere":
          if (!shape.radius) {
            console.error("Radius is required for sphere shape");
            break;
          }
          shapeSettings = new Jolt.SphereShapeSettings(shape.radius, undefined);
          break;
        case "taperedCapsule":
          if (!shape.height || !shape.topRadius || !shape.bottomRadius) {
            console.error(
              "Height, topRadius, and bottomRadius are required for taperedCapsule shape"
            );
            break;
          }
          shapeSettings = new Jolt.TaperedCapsuleShapeSettings(
            shape.height * 0.5,
            shape.topRadius,
            shape.bottomRadius,
            undefined
          );
          break;
        case "convex":
          if (!shape.vertices) {
            console.error("Vertices are required for convex shape");
            break;
          }
          shapeSettings = new Jolt.ConvexHullShapeSettings();
          for (let i = 0; i < shape.vertices.length; i++) {
            shapeSettings.mPoints.push_back(
              new Jolt.Vec3(
                shape.vertices[i][0],
                shape.vertices[i][1],
                shape.vertices[i][2]
              )
            );
          }
          break;
        default:
          console.error("Invalid shape type");
          break;
      }
      compound.AddShape(
        position,
        rotation,
        shapeSettings as Jolt.ShapeSettings,
        0
      );
      Jolt.destroy(position);
      Jolt.destroy(rotation);
      // Jolt.destroy(shapeSettings);
    }

    const shape = compound.Create().Get();
    Jolt.destroy(compound);

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
        new MeshBasicMaterial({ color: "crimson", wireframe: true })
      );
      debugMesh = meshMesh;
      scene.add(meshMesh);
    }

    return { body, shape, debugMesh, geometry };
  }, [
    Jolt,
    bodyInterface,
    shapes,
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
      shape: Jolt.Shape;
      debugMesh: Mesh<
        BufferGeometry<NormalBufferAttributes>,
        Material | Material[],
        Object3DEventMap
      > | null;
      geometry: BufferGeometry<NormalBufferAttributes>;
    }
  ];
};
