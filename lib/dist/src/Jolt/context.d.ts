/// <reference types="react" />
import initJolt from "jolt-physics";
export declare const joltContext: import("react").Context<{
    Jolt: typeof initJolt;
    joltInterface: initJolt.JoltInterface;
    physicsSystem: initJolt.PhysicsSystem;
    bodyInterface: initJolt.BodyInterface;
    layers: {
        LAYER_NON_MOVING: number;
        LAYER_MOVING: number;
    };
} | null>;
