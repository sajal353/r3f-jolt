import { BufferAttribute, BufferGeometry } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

const readTriangles = (JoltModule: JoltModule, shape: Jolt.Shape) => {
  const scale = new JoltModule.Vec3(1, 1, 1);
  const triangles = new JoltModule.ShapeGetTriangles(
    shape,
    JoltModule.AABox.prototype.sBiggest(),
    shape.GetCenterOfMass(),
    JoltModule.Quat.prototype.sIdentity(),
    scale,
  );

  const pointer = triangles.GetVerticesData();
  const count =
    triangles.GetVerticesSize() / Float32Array.BYTES_PER_ELEMENT;

  // An empty shape triangulates to nothing and hands back a null pointer, which
  // a Float32Array view over the heap would reject rather than treat as empty.
  const vertices =
    count > 0
      ? new Float32Array(JoltModule.HEAPF32.buffer, pointer, count).slice()
      : new Float32Array(0);

  JoltModule.destroy(triangles);
  JoltModule.destroy(scale);

  return vertices;
};

export const shapeToGeometry = (
  JoltModule: JoltModule,
  shape: Jolt.Shape,
): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(readTriangles(JoltModule, shape), 3),
  );
  geometry.computeVertexNormals();

  return geometry;
};

/**
 * Re-triangulates a shape into a geometry that already exists, keeping its
 * identity. A deformed heightfield is drawn by two meshes at once — the
 * consumer's and the hook's debug overlay — and a fresh `BufferGeometry` would
 * need a re-render to reach either.
 */
export const refillShapeGeometry = (
  JoltModule: JoltModule,
  shape: Jolt.Shape,
  geometry: BufferGeometry,
) => {
  const vertices = readTriangles(JoltModule, shape);
  const position = geometry.getAttribute("position") as
    | BufferAttribute
    | undefined;

  if (position && position.array.length === vertices.length) {
    (position.array as Float32Array).set(vertices);
    position.needsUpdate = true;
  } else {
    geometry.setAttribute("position", new BufferAttribute(vertices, 3));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
};
