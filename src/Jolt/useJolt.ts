import { useContext } from "react";
import { joltContext } from "./context";

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
  };
};
