import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import { useThree } from "@react-three/fiber";
import type Jolt from "jolt-physics";
import type { VehicleTelemetry } from "@/Jolt/internal/vehicle";
import { useJolt } from "@/Jolt/useJolt";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";
import { Hud } from "./Stage";

export const VEHICLE_KEYS = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "handbrake", keys: ["Space"] },
  { name: "boost", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "reset", keys: ["KeyR"] },
];

const FOLLOW_RATE = 4;

/** A course is bigger than any one view, and the canvas outlives the scene. */
export const useFollowCamera = (spawn: Vec3Tuple, offset: Vec3Tuple) => {
  const camera = useThree((state) => state.camera);
  const orbit = useThree((state) => state.controls) as unknown as {
    target: Vector3;
  } | null;

  const followed = useRef(new Vector3(...spawn));
  const moved = useRef(new Vector3());

  useEffect(() => {
    const start = camera.position.clone();
    const target = orbit?.target.clone();

    followed.current.set(...spawn);
    camera.position.set(...spawn).add(new Vector3(...offset));
    orbit?.target.set(...spawn);

    return () => {
      camera.position.copy(start);
      if (target) orbit?.target.copy(target);
    };
  }, [camera, orbit, spawn, offset]);

  return (position: Vector3, delta: number) => {
    moved.current
      .subVectors(position, followed.current)
      .multiplyScalar(1 - Math.exp(-FOLLOW_RATE * delta));
    followed.current.add(moved.current);
    camera.position.add(moved.current);
    orbit?.target.add(moved.current);
  };
};

/** Puts a vehicle back on the press of the key, once per press. */
export const useResetKey = (spawn: Vec3Tuple, facing: QuatTuple) => {
  const { bodyInterface, temps } = useJolt();
  const held = useRef(false);

  return (pressed: boolean, body: Jolt.Body) => {
    if (pressed && !held.current) {
      bodyInterface.SetPositionRotationAndVelocity(
        body.GetID(),
        temps.rvec3(spawn),
        temps.quat(facing),
        temps.vec3([0, 0, 0]),
        temps.vec3([0, 0, 0]),
      );
    }
    held.current = pressed;
  };
};

const gearLabel = (gear: number) => {
  if (gear === 0) return "N";
  return gear < 0 ? "R" : String(gear);
};

/** Written straight to the DOM from the frame loop, so driving renders no React. */
export const useDashboard = (maxRpm: number, height: number) => {
  const gear = useRef<HTMLElement>(null);
  const rpm = useRef<HTMLElement>(null);
  const needle = useRef<HTMLElement>(null);
  const note = useRef<HTMLElement>(null);

  const show = (telemetry: VehicleTelemetry, noteText: string) => {
    if (gear.current) gear.current.textContent = gearLabel(telemetry.gear);
    if (rpm.current) {
      rpm.current.textContent = String(Math.round(telemetry.rpm));
    }
    if (needle.current) {
      needle.current.style.width = `${(telemetry.rpm / maxRpm) * 100}%`;
    }
    if (note.current) note.current.textContent = noteText;
  };

  const dashboard = (
    <Hud position={[0, height, 0]}>
      <div className="dashboard">
        <b ref={gear}>N</b> <span ref={rpm}>0</span> rpm ·{" "}
        <span ref={note} />
        <div className="tachometer">
          <i ref={needle} />
        </div>
      </div>
    </Hud>
  );

  return { show, dashboard };
};
