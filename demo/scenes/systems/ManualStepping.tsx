import { useState } from "react";
import { Controls, Floor, Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useJolt } from "@/Jolt/useJolt";
import type { Vec3Tuple } from "@/Jolt/types";

const COLORS = ["#8e44ad", "#2980b9", "#16a085", "#d35400", "#c0392b"];

const Brick = ({ position, color }: { position: Vec3Tuple; color: string }) => {
  const [ref] = useBox({
    position,
    size: [1.2, 0.6, 1.2],
    motionType: "dynamic",
    material: { restitution: 0.1 },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1.2, 0.6, 1.2]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Driver = () => {
  const { step, timing } = useJolt();
  const [count, setCount] = useState(0);

  const advance = (steps: number) => {
    for (let i = 0; i < steps; i += 1) step();
    setCount(timing.stepCount);
  };

  return (
    <>
      <Hud position={[0, 8.5, 0]}>step {count}</Hud>
      <Controls position={[0, 7, 0]}>
        <button type="button" onClick={() => advance(1)}>
          step once
        </button>
        <button type="button" onClick={() => advance(10)}>
          step ×10
        </button>
        <button type="button" onClick={() => advance(120)}>
          step ×120
        </button>
      </Controls>
    </>
  );
};

export const ManualStepping = () => (
  <>
    <Floor size={20} />

    {COLORS.map((color, index) => (
      <Brick
        key={color}
        color={color}
        position={[index * 1.4 - 2.8, 2 + index * 1.2, 0]}
      />
    ))}

    <Driver />
  </>
);
