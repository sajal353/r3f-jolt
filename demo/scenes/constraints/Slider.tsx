import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useSliderConstraint } from "@/Jolt/useSliderConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const DRAWER_SIZE: Vec3Tuple = [1.6, 1, 1.6];

const Drawer = ({ x, friction }: { x: number; friction: number }) => {
  const start: Vec3Tuple = [x, 1, 0];
  const [ref, drawer] = useBox({
    size: DRAWER_SIZE,
    position: start,
    motionType: "dynamic",
    mass: 10,
  });

  useSliderConstraint(null, drawer, {
    point: start,
    sliderAxis: [0, 0, 1],
    normalAxis: [0, 1, 0],
    limits: { min: -3, max: 3 },
    maxFrictionForce: friction,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={DRAWER_SIZE} />
      <meshStandardMaterial color={friction > 0 ? "#8e44ad" : "#3498db"} />
    </mesh>
  );
};

/** Purely decorative: the slider itself joins to the world, not to this. */
const Bracket = ({ x }: { x: number }) => {
  const [ref] = useBox({
    size: [0.4, 0.4, 0.4],
    position: [x, 6, 0],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.4, 0.4, 0.4]} />
      <meshStandardMaterial color="#4a4a4a" />
    </mesh>
  );
};

/**
 * A vertical slider carries the whole weight of the platform, so it drops to its
 * lower limit and stops there — no motor needed to show the travel bound.
 */
const Lift = ({ x }: { x: number }) => {
  const [ref, platform] = useBox({
    size: [2.5, 0.3, 2.5],
    position: [x, 5, 0],
    motionType: "dynamic",
    mass: 30,
  });

  useSliderConstraint(null, platform, {
    point: [x, 5, 0],
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: -3.5, max: 0 },
    debug: true,
  });

  return (
    <>
      <Bracket x={x} />
      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.3, 2.5]} />
        <meshStandardMaterial color="#2ecc71" />
      </mesh>
    </>
  );
};

const Cargo = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.4,
    position: [x, 8, 0],
    motionType: "dynamic",
    mass: 8,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.4, 20, 20]} />
      <meshStandardMaterial color="#f1c40f" />
    </mesh>
  );
};

const Shunter = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.5,
    position: [x, 1, -6],
    motionType: "dynamic",
    mass: 30,
    initialVelocity: [0, 0, 8],
    gravityFactor: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 20, 20]} />
      <meshStandardMaterial color="#e74c3c" />
    </mesh>
  );
};

export const SliderConstraintScene = () => (
  <>
    <Floor size={40} />

    <Drawer x={-6} friction={0} />
    <Drawer x={-2} friction={400} />
    <Shunter x={-6} />
    <Shunter x={-2} />

    <Lift x={4} />
    <Cargo x={4} />

    <Tag position={[-6, 3.5, 0]}>free · slides to its limit</Tag>
    <Tag position={[-2, 3.5, 0]}>maxFrictionForce 400</Tag>
    <Tag position={[4, 8.5, 0]}>vertical · stops at min</Tag>
  </>
);
