import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";

const Puck = ({
  x,
  color,
  onFire,
  label,
}: {
  x: number;
  color: string;
  label: string;
  onFire: (api: NonNullable<ReturnType<typeof useBox>[1]>) => void;
}) => {
  const [ref, api] = useBox({
    position: [x, 0.4, 4],
    size: [1, 0.8, 1],
    motionType: "dynamic",
    mass: 2,
    material: { friction: 0.2 },
  });

  return (
    <>
      <mesh ref={ref} castShadow onClick={() => api && onFire(api)}>
        <boxGeometry args={[1, 0.8, 1]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Tag position={[x, 2, 4]}>{label}</Tag>
    </>
  );
};

const LANE = 8;
const RUN_SPEED = 6;

/**
 * Stopping something dead only reads as anything if it was moving, so this one
 * runs up and down the lane until you click it. Zeroing both velocities is a
 * thing an impulse cannot do without first knowing what the body was doing.
 */
const Runner = ({ onNote }: { onNote: (note: string) => void }) => {
  const [ref, api] = useBox({
    position: [6, 0.4, 4],
    size: [1, 0.8, 1],
    motionType: "dynamic",
    mass: 2,
    material: { friction: 0 },
    linearDamping: 0,
    angularDamping: 0,
    initialVelocity: [0, 0, -RUN_SPEED],
    initialAngularVelocity: [0, 3, 0],
  });

  const running = useRef(true);

  useFrame(() => {
    if (!api || !running.current) return;

    const z = api.body.GetPosition().GetZ();
    if (Math.abs(z) < LANE) return;

    api.setLinearVelocity([0, 0, z > 0 ? -RUN_SPEED : RUN_SPEED]);
  });

  return (
    <>
      <mesh
        ref={ref}
        castShadow
        onClick={() => {
          if (!api) return;

          if (running.current) {
            api.setVelocities([0, 0, 0], [0, 0, 0]);
            onNote("velocities zeroed — stopped dead mid-run");
          } else {
            api.setVelocities([0, 0, -RUN_SPEED], [0, 3, 0]);
            onNote("moving and spinning again, from one call");
          }

          running.current = !running.current;
        }}
      >
        <boxGeometry args={[1, 0.8, 1]} />
        <meshStandardMaterial color="#e74c3c" />
      </mesh>
      <Tag position={[6, 2, 4]}>stop dead · click again to relaunch</Tag>
    </>
  );
};

export const Velocities = () => {
  const [note, setNote] = useState("click a puck");

  return (
    <>
      <Floor size={50} />

      {/* setLinearVelocity replaces the velocity outright — unlike an impulse,
          the result does not depend on mass or on what the body was doing. */}
      <Puck
        x={-6}
        color="#3498db"
        label="setLinearVelocity"
        onFire={(api) => {
          api.setLinearVelocity([0, 0, -8]);
          setNote("velocity replaced with (0, 0, −8)");
        }}
      />

      <Puck
        x={-2}
        color="#9b59b6"
        label="setAngularVelocity"
        onFire={(api) => {
          api.setAngularVelocity([0, 10, 0]);
          setNote("spinning at 10 rad/s about Y");
        }}
      />

      <Puck
        x={2}
        color="#16a085"
        label="setVelocities"
        onFire={(api) => {
          api.setVelocities([0, 0, -8], [0, 10, 0]);
          setNote("both set in one call");
        }}
      />

      <Runner onNote={setNote} />

      <Hud position={[0, 6, 0]}>{note}</Hud>
    </>
  );
};
