import type { ReactNode } from "react";
import { Html } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import type { QuatTuple } from "@/Jolt/types";

export const Floor = ({
  size = 40,
  color = "#2a2a2a",
  friction = 0.6,
  restitution = 0,
}: {
  size?: number;
  color?: string;
  friction?: number;
  restitution?: number;
}) => {
  const [ref] = useBox({
    position: [0, -0.5, 0],
    size: [size, 1, size],
    motionType: "static",
    material: { friction, restitution },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[size, 1, size]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

export const Wall = ({
  position,
  size,
  rotation,
  friction,
  color = "#3a3a3a",
}: {
  position: [number, number, number];
  size: [number, number, number];
  rotation?: QuatTuple;
  friction?: number;
  color?: string;
}) => {
  const [ref] = useBox({
    position,
    size,
    rotation,
    motionType: "static",
    material: friction === undefined ? undefined : { friction },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/** A readout pinned in world space, for numbers a scene wants to show. */
export const Hud = ({
  position = [0, 7, 0],
  children,
}: {
  position?: [number, number, number];
  children: ReactNode;
}) => (
  <Html position={position} center>
    <div className="hud">{children}</div>
  </Html>
);

/** A label sitting above whatever it describes. */
export const Tag = ({
  position,
  children,
}: {
  position: [number, number, number];
  children: ReactNode;
}) => (
  <Html position={position} center>
    <div className="tag">{children}</div>
  </Html>
);
