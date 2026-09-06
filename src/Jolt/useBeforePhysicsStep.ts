import { useEffect } from "react";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { StepCallback } from "./types";

/**
 * Runs immediately before every physics step, which is not the same thing as
 * every frame: a fixed timestep can run several steps in one frame or none at
 * all, and a force applied per frame is then a force applied at the wrong
 * strength. Anything that has to be integrated — buoyancy, thrust, a custom
 * gravity field — belongs here rather than in `useFrame`.
 *
 * The callback runs *between* Jolt's steps, not inside one, so the world is
 * yours to touch: read positions, apply forces, even create a body. Do not
 * call `setState` from it — a render scheduled from inside the step loop fires
 * once per sub-step, in the worst part of the frame to do it.
 */
export const useBeforePhysicsStep = (callback: StepCallback) => {
  const api = useJolt();
  const callbackRef = useHandlerRef(callback);

  useEffect(
    () =>
      api.steps.add("before", (delta, index) =>
        callbackRef.current(delta, index),
      ),
    [api, callbackRef],
  );
};
