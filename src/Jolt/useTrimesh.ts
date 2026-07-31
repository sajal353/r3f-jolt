import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from "three";
import type Jolt from "jolt-physics";
import { finishShape, useBody, type BodyOptions } from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";

export type TrimeshSource =
  | BufferGeometry
  | {
      position: BufferAttribute | InterleavedBufferAttribute;
      index?: ArrayLike<number>;
    };

export interface UseTrimeshOptions extends Omit<BodyOptions, "motionType"> {
  mesh: TrimeshSource;
  motionType?: "static";
}

const readSource = (mesh: TrimeshSource) => {
  const position =
    "position" in mesh
      ? mesh.position
      : (mesh.getAttribute("position") as BufferAttribute);

  const index =
    "position" in mesh ? mesh.index : (mesh.getIndex()?.array ?? undefined);

  if (!position) {
    throw new Error("[r3f-jolt] useTrimesh: the mesh has no position attribute");
  }

  return { position, index };
};

export const useTrimesh = (options: UseTrimeshOptions) => {
  const { mesh } = options;

  return useBody<Jolt.Shape>(
    (jolt) => {
      const { position, index } = readSource(mesh);

      const vertexList = new jolt.VertexList();
      vertexList.reserve(position.count);

      const vertex = new jolt.Float3(0, 0, 0);
      for (let i = 0; i < position.count; i += 1) {
        vertex.x = position.getX(i);
        vertex.y = position.getY(i);
        vertex.z = position.getZ(i);
        vertexList.push_back(vertex);
      }
      jolt.destroy(vertex);

      const indexCount = index ? index.length : position.count;
      const triangleList = new jolt.IndexedTriangleList();
      triangleList.reserve(indexCount / 3);

      const triangle = new jolt.IndexedTriangle();
      triangle.mMaterialIndex = 0;

      for (let i = 0; i < indexCount; i += 3) {
        triangle.set_mIdx(0, index ? index[i] : i);
        triangle.set_mIdx(1, index ? index[i + 1] : i + 1);
        triangle.set_mIdx(2, index ? index[i + 2] : i + 2);
        triangleList.push_back(triangle);
      }
      jolt.destroy(triangle);

      const materials = new jolt.PhysicsMaterialList();
      materials.push_back(new jolt.PhysicsMaterial());

      const settings = new jolt.MeshShapeSettings(
        vertexList,
        triangleList,
        materials,
      );
      const result = settings.Create();
      const shape = finishShape(result.Get());
      result.Clear();

      jolt.destroy(settings);
      jolt.destroy(materials);
      jolt.destroy(triangleList);
      jolt.destroy(vertexList);

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    { ...options, motionType: "static" },
    "trimesh",
  );
};
