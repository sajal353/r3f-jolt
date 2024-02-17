import { Mesh, Vector3 } from "three";
import Jolt from "jolt-physics";
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
        velocityUpdater?: ((velocity: Vector3) => Vector3) | undefined;
    };
    position: [number, number, number];
    rotation?: [number, number, number, number] | undefined;
    debug?: boolean | undefined;
    mass?: number | undefined;
}) => [{
    character: Jolt.CharacterVirtual;
    update: (direction: Vector3, jump: boolean, deltaTime: number) => void;
    debugMesh: Mesh | null;
}];
