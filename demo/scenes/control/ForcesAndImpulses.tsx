import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";

/** Force accumulates over the step, so it has to be re-applied every frame. */
const Hovering = () => {
  const [ref, api] = useBox({
    position: [-5, 3, 0],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 2,
    linearDamping: 1.2,
  });

  useFrame(() => {
    // mass × g, so it hangs. Stop applying and it drops immediately.
    api?.applyForce([0, 2 * 9.81, 0]);
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#3498db" />
    </mesh>
  );
};

/** Impulse is instantaneous — one call, one velocity change. */
const Poppable = ({ x, offCentre }: { x: number; offCentre: boolean }) => {
  const [ref, api] = useBox({
    position: [x, 0.5, 0],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 2,
    material: { friction: 0.4 },
  });

  return (
    <mesh
      ref={ref}
      castShadow
      onClick={() =>
        offCentre
          ? // A point argument makes it spin: the impulse is applied at the
            // corner rather than through the centre of mass.
            api?.applyImpulse([0, 9, 0], [x + 0.5, 1, 0.5])
          : api?.applyImpulse([0, 9, 0])
      }
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={offCentre ? "#e67e22" : "#2ecc71"} />
    </mesh>
  );
};

/** Torque spins it up gradually; angular impulse kicks it at once. */
const Spinner = ({
  x,
  mode,
  color,
}: {
  x: number;
  mode: "torque" | "impulse";
  color: string;
}) => {
  const [ref, api] = useSphere({
    radius: 0.6,
    position: [x, 3, 4],
    motionType: "dynamic",
    mass: 2,
    gravityFactor: 0,
    angularDamping: 0.4,
  });

  const held = useRef(false);

  useFrame(() => {
    if (mode === "torque" && held.current) api?.applyTorque([0, 6, 0]);
  });

  return (
    <mesh
      ref={ref}
      castShadow
      onPointerDown={() => {
        held.current = true;
        if (mode === "impulse") api?.applyAngularImpulse([0, 4, 0]);
      }}
      onPointerUp={() => {
        held.current = false;
      }}
    >
      <sphereGeometry args={[0.6, 16, 12]} />
      <meshStandardMaterial color={color} wireframe />
    </mesh>
  );
};

export const ForcesAndImpulses = () => (
  <>
    <Floor size={40} />

    <Hovering />
    <Tag position={[-5, 5, 0]}>applyForce every frame · mass × g</Tag>

    <Poppable x={-1} offCentre={false} />
    <Poppable x={2} offCentre />
    <Tag position={[-1, 2.5, 0]}>applyImpulse</Tag>
    <Tag position={[2, 2.5, 0]}>applyImpulse at a point → spin</Tag>

    <Spinner x={-2} mode="torque" color="#9b59b6" />
    <Spinner x={2} mode="impulse" color="#16a085" />
    <Tag position={[-2, 4.5, 4]}>hold: applyTorque</Tag>
    <Tag position={[2, 4.5, 4]}>click: applyAngularImpulse</Tag>

    <Hud position={[0, 8, 0]}>
      click the boxes · click and hold the wireframe spheres
    </Hud>
  </>
);
