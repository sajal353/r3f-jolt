/// <reference types="react" />
import { BufferGeometry, Material, Mesh, NormalBufferAttributes, Object3DEventMap } from "three";
import Jolt from "jolt-physics";
export declare const useTaperedCapsule: ({ topRadius, bottomRadius, height, position, rotation, motionType, debug, mass, material, }: {
    topRadius: number;
    bottomRadius: number;
    height: number;
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
