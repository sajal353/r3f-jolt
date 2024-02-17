import Jolt from "jolt-physics";
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
