import { useCallback, useEffect, useRef, useState } from "react";
import { useJolt } from "./useJolt";
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
  Material,
  Mesh,
  MeshBasicMaterial,
  NormalBufferAttributes,
  Object3DEventMap,
  Quaternion,
  TypedArray,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import Jolt from "jolt-physics";

export const useTrimesh = ({
  mesh,
  position,
  debug = false,
  material,
  initialVelocity,
  bodySettingsOverride,
}: {
  mesh: {
    position: BufferAttribute | InterleavedBufferAttribute;
    index: TypedArray;
  };
  position: [number, number, number];
  debug?: boolean;
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
    shape: Jolt.Shape;
    debugMesh: Mesh<
      BufferGeometry<NormalBufferAttributes>,
      Material | Material[],
      Object3DEventMap
    > | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
  }>();

  const init = useCallback(() => {
    const verts = new Jolt.VertexList();

    for (let i = 0; i < mesh.position.count; i++) {
      verts.push_back(
        new Jolt.Float3(
          mesh.position.getX(i),
          mesh.position.getY(i),
          mesh.position.getZ(i)
        )
      );
    }

    const tris = new Jolt.IndexedTriangleList();

    for (let i = 0; i < mesh.index.length; i += 3) {
      tris.push_back(
        new Jolt.IndexedTriangle(
          mesh.index[i],
          mesh.index[i + 1],
          mesh.index[i + 2],
          0
        )
      );
    }

    const mats = new Jolt.PhysicsMaterialList();
    mats.push_back(new Jolt.PhysicsMaterial());

    const shape = new Jolt.MeshShapeSettings(verts, tris, mats).Create().Get();

    Jolt.destroy(verts);
    Jolt.destroy(tris);
    Jolt.destroy(mats);

    const bodySettings = new Jolt.BodyCreationSettings(
      shape,
      new Jolt.Vec3(position[0], position[1], position[2]),
      new Jolt.Quat(0, 0, 0, 1),
      Jolt.EMotionType_Static,
      layers.LAYER_NON_MOVING
    );

    if (bodySettingsOverride) {
      bodySettingsOverride(bodySettings);
    }

    const body = bodyInterface.CreateBody(bodySettings);

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
        new MeshBasicMaterial({ color: "hotpink", wireframe: true })
      );
      debugMesh = meshMesh;
      scene.add(meshMesh);
    }

    return {
      api: { body, shape, debugMesh, geometry },
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
