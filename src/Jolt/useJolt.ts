import { useContext } from "react";
import { joltContext } from "./context";
import type { JoltApi } from "./types";

export const useJolt = (): JoltApi => {
  const api = useContext(joltContext);

  if (api === null) {
    throw new Error("Jolt hooks must be used within a <Physics> provider");
  }

  return api;
};
