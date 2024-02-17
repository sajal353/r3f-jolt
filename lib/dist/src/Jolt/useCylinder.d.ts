/// <reference types="react" />
import { BufferGeometry, Material, Mesh, NormalBufferAttributes, Object3DEventMap } from "three";
import Jolt from "jolt-physics";
export declare const useCylinder: ({ height, radius, position, rotation, motionType, debug, mass, material, }: {
    height: number;
    radius: number;
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
    shape: Jolt.CylinderShape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
}];
