/// <reference types="react" />
import { BufferGeometry, Material, Mesh, NormalBufferAttributes, Object3DEventMap } from "three";
import Jolt from "jolt-physics";
export declare const useCompound: ({ shapes, position, rotation, motionType, debug, mass, material, }: {
    shapes: {
        type: "box" | "capsule" | "cylinder" | "sphere" | "taperedCapsule" | "convex";
        position: [number, number, number];
        rotation?: [number, number, number, number] | undefined;
        size?: [number, number, number] | undefined;
        height?: number | undefined;
        radius?: number | undefined;
        topRadius?: number | undefined;
        bottomRadius?: number | undefined;
        vertices?: number[][] | undefined;
    }[];
    position: [number, number, number];
    rotation?: [number, number, number, number] | undefined;
    motionType: "static" | "dynamic";
    debug?: boolean | undefined;
    mass?: number | undefined;
    material?: {
        friction?: number | undefined;
        restitution?: number | undefined;
    } | undefined;
}) => [import("react").RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.Shape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
}];
