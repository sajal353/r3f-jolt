import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/**
 * A position motor takes a setpoint, not a speed. Hand it a distant target and
 * it closes the gap as fast as its force limit allows, so the same door slams
 * open and drifts shut the moment anything — a limit, gravity — helps one
 * direction and not the other, and a target set right on a limit overshoots
 * hard enough to punch through it before the limit catches up.
 *
 * Walking the setpoint at a fixed rate instead makes every direction take the
 * same time by construction, and is how a real powered door or lift is driven:
 * the motor is always chasing a target a few millimetres away.
 */
export const useSetpoint = (
  target: number,
  rate: number,
  drive: ((value: number) => void) | undefined,
) => {
  const setpoint = useRef(target);

  useFrame((_, delta) => {
    const gap = target - setpoint.current;
    if (gap === 0) return;

    // A tab left in the background hands back one enormous delta; without the
    // clamp the setpoint jumps the whole way and the slam is back.
    const travel = rate * Math.min(delta, 1 / 30);

    setpoint.current =
      Math.abs(gap) <= travel
        ? target
        : setpoint.current + Math.sign(gap) * travel;

    drive?.(setpoint.current);
  });
};
