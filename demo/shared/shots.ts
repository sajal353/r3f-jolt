import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import type { Vec3Tuple } from "@/Jolt/types";

const CLICK_SLOP = 4;
const SHOT_SPEED = 22;
const SHOT_CAP = 12;

export interface Shot {
  id: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

/** A click (not a drag, which orbits) throws a ball from the camera. */
export const useShots = () => {
  const canvas = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera);
  const raycaster = useThree((state) => state.raycaster);
  const [shots, setShots] = useState<Shot[]>([]);
  const nextID = useRef(0);

  useEffect(() => {
    const down = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      down.x = event.clientX;
      down.y = event.clientY;
    };

    const onUp = (event: PointerEvent) => {
      const travel = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (travel > CLICK_SLOP) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const origin = raycaster.ray.origin
        .clone()
        .addScaledVector(raycaster.ray.direction, 1);
      const velocity = raycaster.ray.direction.clone().multiplyScalar(SHOT_SPEED);
      nextID.current += 1;
      const shot: Shot = {
        id: nextID.current,
        position: [origin.x, origin.y, origin.z],
        velocity: [velocity.x, velocity.y, velocity.z],
      };
      setShots((current) => [
        ...current.slice(Math.max(0, current.length - (SHOT_CAP - 1))),
        shot,
      ]);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [canvas, camera, raycaster]);

  return shots;
};

