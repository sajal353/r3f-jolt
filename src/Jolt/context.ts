import { createContext } from "react";
import type { JoltApi } from "./types";

export const joltContext = createContext<JoltApi | null>(null);

/**
 * `<Physics debug>`, kept out of the world's context value: a change there
 * would hand every hook a new `api`, and each one would tear its body down and
 * build it again.
 */
export const physicsDebugContext = createContext(false);
