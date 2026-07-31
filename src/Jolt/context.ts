import { createContext } from "react";
import type { JoltApi } from "./types";

export const joltContext = createContext<JoltApi | null>(null);
