import { BufferAttribute } from 'three';
import { BufferGeometry } from 'three';
import { InterleavedBufferAttribute } from 'three';
import Jolt from 'jolt-physics';
import { JSX as JSX_2 } from 'react/jsx-runtime';
import { Material } from 'three';
import { MemoExoticComponent } from 'react';
import { Mesh } from 'three';
import { NormalBufferAttributes } from 'three';
import { Object3DEventMap } from 'three';
import { RefObject } from 'react';
import { TypedArray } from 'three';
import { Vector3 } from 'three';

export declare const Physics: MemoExoticComponent<({ gravity, children, }: {
    gravity?: [number, number, number] | undefined;
    children: React.ReactNode;
}) => JSX_2.Element | null>;

export declare const useBox: ({ size, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
    size: [number, number, number];
    position: [number, number, number];
    rotation?: [number, number, number, number] | undefined;
    motionType: "static" | "dynamic";
    debug?: boolean | undefined;
    mass?: number | undefined;
    material?: {
        friction?: number | undefined;
        restitution?: number | undefined;
    } | undefined;
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.BoxShape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
}];

export declare const useCapsule: ({ height, radius, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.CapsuleShape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
}];

export declare const useCharacter: ({ options, position, rotation, debug, mass, }: {
    options: {
        height: {
            standing: number;
        };
        radius: {
            standing: number;
        };
        moveDuringJump: boolean;
        moveSpeed: number;
        jumpSpeed: number;
        enableInertia: boolean;
        enableStairStep: boolean;
        enableStickToFloor: boolean;
    };
    position: [number, number, number];
    rotation?: [number, number, number, number] | undefined;
    debug?: boolean | undefined;
    mass?: number | undefined;
}) => [{
    character: Jolt.CharacterVirtual;
    update: (direction: Vector3, jump: boolean, deltaTime: number, overrideUpdate?: ((velocity: Vector3, up: Vector3) => Vector3) | undefined) => void;
    debugMesh: Mesh | null;
}];

export declare const useClosestHitRaycaster: ({ origin, direction, }: {
    origin: [number, number, number];
    direction: [number, number, number];
}) => [{
    ray: Jolt.RRayCast;
    cast: (origin: Vector3 | undefined) => {
        collector: Jolt.CastRayClosestHitCollisionCollector;
        distance: number;
        hit: boolean;
    };
}];

export declare const useCompound: ({ shapes, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.Shape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
}];

export declare const useConvex: ({ vertices, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
    vertices: number[][];
    position: [number, number, number];
    rotation?: [number, number, number, number] | undefined;
    motionType: "static" | "dynamic";
    debug?: boolean | undefined;
    mass?: number | undefined;
    material?: {
        friction?: number | undefined;
        restitution?: number | undefined;
    } | undefined;
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.Shape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
}];

export declare const useCylinder: ({ height, radius, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.CylinderShape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
}];

export declare const useJolt: () => {
    Jolt: typeof Jolt;
    joltInterface: Jolt.JoltInterface;
    physicsSystem: Jolt.PhysicsSystem;
    bodyInterface: Jolt.BodyInterface;
    layers: {
        LAYER_NON_MOVING: number;
        LAYER_MOVING: number;
    };
};

export declare const useSphere: ({ radius, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.SphereShape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
}];

export declare const useTaperedCapsule: ({ topRadius, bottomRadius, height, position, rotation, motionType, debug, mass, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.Shape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
}];

export declare const useTrimesh: ({ mesh, position, debug, material, bodySettingsOverride, }: {
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
    bodySettingsOverride?: ((settings: Jolt.BodyCreationSettings) => void) | undefined;
}) => [RefObject<Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap>>, {
    body: Jolt.Body;
    shape: Jolt.Shape;
    debugMesh: Mesh<BufferGeometry<NormalBufferAttributes>, Material | Material[], Object3DEventMap> | null;
    geometry: BufferGeometry<NormalBufferAttributes>;
}];

export { }
