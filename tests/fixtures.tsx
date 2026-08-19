import { BufferAttribute, BufferGeometry } from "three";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCapsule } from "@/Jolt/useCapsule";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import { useConvex } from "@/Jolt/useConvex";
import { useCompound } from "@/Jolt/useCompound";
import { useTrimesh } from "@/Jolt/useTrimesh";
import { usePlane } from "@/Jolt/usePlane";
import { useHeightField } from "@/Jolt/useHeightField";
import { useTaperedCylinder } from "@/Jolt/useTaperedCylinder";
import { useEmpty } from "@/Jolt/useEmpty";

export const cubeVertices: number[][] = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

export const makeQuadGeometry = () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
};

const Box = () => {
  useBox({ size: [1, 1, 1], position: [0, 5, 0], motionType: "dynamic" });
  return null;
};

const Sphere = () => {
  useSphere({ radius: 0.5, position: [0, 5, 0], motionType: "dynamic" });
  return null;
};

const Capsule = () => {
  useCapsule({
    height: 1,
    radius: 0.3,
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const Cylinder = () => {
  useCylinder({
    height: 1,
    radius: 0.3,
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const TaperedCapsule = () => {
  useTaperedCapsule({
    topRadius: 0.2,
    bottomRadius: 0.4,
    height: 1,
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const Convex = () => {
  useConvex({
    vertices: cubeVertices,
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const Compound = () => {
  useCompound({
    shapes: [
      { type: "box", position: [0, 0, 0], size: [0.5, 0.5, 0.5] },
      { type: "sphere", position: [0, 0.5, 0], radius: 0.3 },
    ],
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const Trimesh = () => {
  useTrimesh({ mesh: makeQuadGeometry(), position: [0, 0, 0] });
  return null;
};

export const rollingHills = (x: number, z: number) =>
  Math.sin(x * 0.4) * Math.cos(z * 0.4);

const Plane = () => {
  usePlane({ position: [0, 0, 0], motionType: "static", halfExtent: 20 });
  return null;
};

const HeightField = () => {
  useHeightField({
    heights: rollingHills,
    sampleCount: 8,
    blockSize: 2,
    position: [0, 0, 0],
  });
  return null;
};

const TaperedCylinder = () => {
  useTaperedCylinder({
    topRadius: 0.1,
    bottomRadius: 0.4,
    height: 1,
    position: [0, 5, 0],
    motionType: "dynamic",
  });
  return null;
};

const Empty = () => {
  useEmpty({ position: [0, 5, 0], motionType: "dynamic" });
  return null;
};

export const shapeHooks = [
  ["useBox", Box],
  ["useSphere", Sphere],
  ["useCapsule", Capsule],
  ["useCylinder", Cylinder],
  ["useTaperedCapsule", TaperedCapsule],
  ["useConvex", Convex],
  ["useCompound", Compound],
  ["useTrimesh", Trimesh],
  ["usePlane", Plane],
  ["useHeightField", HeightField],
  ["useTaperedCylinder", TaperedCylinder],
  ["useEmpty", Empty],
] as const;
