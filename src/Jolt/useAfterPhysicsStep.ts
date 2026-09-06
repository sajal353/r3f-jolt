import { useEffect } from "react";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { StepCallback } from "./types";

/**
 * Runs immediately after every physics step — the place to sample the world at
 * the rate it actually simulates at. A trail, a peak-speed reading or a
 * recorded replay taken in `useFrame` misses whatever happened in the other
 * sub-steps of that frame.
 *
 * Same rules as `useBeforePhysicsStep`: between steps rather than inside one,
 * so the world is safe to touch, but do not `setState` from it. Contact events
 * are delivered once per frame, after the last step, so a contact from this
 * step has not been dispatched yet when this runs.
 */
export const useAfterPhysicsStep = (callback: StepCallback) => {
  const api = useJolt();
  const callbackRef = useHandlerRef(callback);

  useEffect(
    () =>
      api.steps.add("after", (delta, index) =>
        callbackRef.current(delta, index),
      ),
    [api, callbackRef],
  );
};
