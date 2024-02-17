/// <reference types="react" />
import { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Material, Mesh, NormalBufferAttributes, Object3DEventMap, TypedArray } from "three";
import Jolt from "jolt-physics";
export declare const useTrimesh: ({ mesh, position, debug, material, }: {
    mesh: {
        position: BufferAttribute | InterleavedBufferAttribute;
        index: TypedArray;
    };
    position: [number, number, number];
    debug?: boolean | undefined;
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
