import { useContext } from "react";
import { joltContext } from "./context";
import Jolt from "jolt-physics";

export const useJolt = () => {
  const api = useContext(joltContext);

  if (api === null) {
    throw new Error("Jolt hooks must be used within a Jolt Physics Provider");
  }

  const { Jolt, joltInterface, physicsSystem, bodyInterface, layers } = api;

  return {
    Jolt,
    joltInterface,
    physicsSystem,
    bodyInterface,
    layers,
  } as {
    Jolt: typeof Jolt;
    joltInterface: Jolt.JoltInterface;
    physicsSystem: Jolt.PhysicsSystem;
    bodyInterface: Jolt.BodyInterface;
    layers: {
      LAYER_NON_MOVING: number;
      LAYER_MOVING: number;
    };
  };
};
