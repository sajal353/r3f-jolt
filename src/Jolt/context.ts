import initJolt from "jolt-physics";
import { createContext } from "react";

export const joltContext = createContext<{
  Jolt: typeof initJolt;
  joltInterface: initJolt.JoltInterface;
  physicsSystem: initJolt.PhysicsSystem;
  bodyInterface: initJolt.BodyInterface;
  layers: {
    LAYER_NON_MOVING: number;
    LAYER_MOVING: number;
  };
} | null>(null);
