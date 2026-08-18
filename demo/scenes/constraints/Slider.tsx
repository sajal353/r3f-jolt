import { Controls, Floor, Tag } from "../../shared/Stage";
import { Projectile } from "./Projectile";
import { useBox } from "@/Jolt/useBox";
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
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={DRAWER_SIZE} />
      <meshStandardMaterial color={friction > 0 ? "#8e44ad" : "#3498db"} />
    </mesh>
  );
};

const Shunter = ({ x }: { x: number }) => (
  <Projectile
    from={[x, 1.4, -6]}
    to={[x, 1, -DRAWER_SIZE[2] / 2]}
    seconds={0.6}
    radius={0.5}
    mass={30}
    color="#e74c3c"
  />
);

const HAMMER_X = 4;
const HAMMER_SIZE: Vec3Tuple = [2, 1, 2];
const HAMMER_TOP = 6;
/** Enough travel that the head reaches the floor, so the bricks stop it, not the joint. */
const HAMMER_DROP = HAMMER_TOP - HAMMER_SIZE[1] / 2 - 0.1;
const BRICK = 0.7;

/** Decoration, but honest decoration: the posts span the travel the joint allows. */
const GuidePost = ({ z }: { z: number }) => {
  const size: Vec3Tuple = [0.25, HAMMER_TOP + 0.6, 0.25];
  const [ref] = useBox({
    size,
    position: [HAMMER_X, size[1] / 2, z],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#4a4a4a" />
    </mesh>
  );
};

const Brick = ({ index }: { index: number }) => {
  const [ref] = useBox({
    size: [BRICK, BRICK, BRICK],
    position: [HAMMER_X + (index - 1) * (BRICK + 0.05), BRICK / 2, 0],
    motionType: "dynamic",
    mass: 2,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[BRICK, BRICK, BRICK]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

/**
 * A vertical slider is a guide, not a support: nothing holds the head up, so it
 * falls along its axis and stops dead at the lower limit. Resetting it teleports
 * the head back and drops the solver's accumulated impulses, which is what
 * `resetWarmStart` is for — otherwise the joint spends a few frames correcting
 * for where the head used to be.
 */
const DropHammer = () => {
  const home: Vec3Tuple = [HAMMER_X, HAMMER_TOP, 0];
  const [ref, head] = useBox({
    size: HAMMER_SIZE,
    position: home,
    motionType: "dynamic",
    mass: 200,
  });

  const [joint] = useSliderConstraint(null, head, {
    point: home,
    sliderAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: -HAMMER_DROP, max: 0 },
  });

  const raise = () => {
    head?.setPositionAndRotation(home, [0, 0, 0, 1], true);
    head?.setVelocities([0, 0, 0], [0, 0, 0]);
    joint?.resetWarmStart();
  };

  return (
    <>
      <GuidePost z={-1.4} />
      <GuidePost z={1.4} />

      <mesh ref={ref} castShadow receiveShadow>
        <boxGeometry args={HAMMER_SIZE} />
        <meshStandardMaterial color="#2ecc71" metalness={0.4} />
      </mesh>

      {[0, 1, 2].map((index) => (
        <Brick key={index} index={index} />
      ))}

      <Controls position={[HAMMER_X, 8.4, 0]}>
        <button onClick={raise}>reset hammer</button>
      </Controls>
    </>
  );
};

export const SliderConstraintScene = () => (
  <>
    <Floor size={40} />

    <Drawer x={-6} friction={0} />
    <Drawer x={-2} friction={400} />
    <Shunter x={-6} />
    <Shunter x={-2} />

    <DropHammer />

    <Tag position={[-6, 3.5, 0]}>free · slides to its limit</Tag>
    <Tag position={[-2, 3.5, 0]}>maxFrictionForce 400</Tag>
    <Tag position={[HAMMER_X, 7.4, 0]}>vertical · falls to its lower limit</Tag>
  </>
);
