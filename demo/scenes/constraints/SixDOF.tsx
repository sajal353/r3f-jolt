import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useSixDOFConstraint } from "@/Jolt/useSixDOFConstraint";
import type { UseSixDOFConstraintOptions } from "@/Jolt/useSixDOFConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const RIG_SIZE: Vec3Tuple = [1.4, 1.4, 1.4];

const Rig = ({
  x,
  axes,
  color,
}: {
  x: number;
  axes: UseSixDOFConstraintOptions["axes"];
  color: string;
}) => {
  const home: Vec3Tuple = [x, 2, 0];
  const [ref, body] = useBox({
    size: RIG_SIZE,
    position: home,
    motionType: "dynamic",
    mass: 12,
  });

  useSixDOFConstraint(null, body, {
    position: home,
    axes,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={RIG_SIZE} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Nudger = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.35,
    position: [x - 0.5, 2.6, -6],
    motionType: "dynamic",
    mass: 20,
    initialVelocity: [0, 0, 9],
    gravityFactor: 0,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 16, 16]} />
      <meshStandardMaterial color="#e74c3c" />
    </mesh>
  );
};

const LOCKED_EXCEPT_SLIDE: UseSixDOFConstraintOptions["axes"] = {
  translationX: { limits: { min: -3, max: 3 } },
  translationY: { limits: "fixed" },
  translationZ: { limits: "fixed" },
  rotationX: { limits: "fixed" },
  rotationY: { limits: "fixed" },
  rotationZ: { limits: "fixed" },
};

const LOCKED_EXCEPT_SPIN: UseSixDOFConstraintOptions["axes"] = {
  translationX: { limits: "fixed" },
  translationY: { limits: "fixed" },
  translationZ: { limits: "fixed" },
  rotationX: { limits: "fixed" },
  rotationY: { limits: "free" },
  rotationZ: { limits: "fixed" },
};

const SLIDE_AND_SPIN: UseSixDOFConstraintOptions["axes"] = {
  translationX: { limits: { min: -3, max: 3 }, maxFriction: 15 },
  translationY: { limits: "fixed" },
  translationZ: { limits: "fixed" },
  rotationX: { limits: "fixed" },
  rotationY: { limits: "free" },
  rotationZ: { limits: "fixed" },
};

export const SixDOFConstraintScene = () => (
  <>
    <Floor size={40} />

    <Rig x={-6} axes={LOCKED_EXCEPT_SLIDE} color="#3498db" />
    <Rig x={0} axes={LOCKED_EXCEPT_SPIN} color="#2ecc71" />
    <Rig x={6} axes={SLIDE_AND_SPIN} color="#9b59b6" />

    <Nudger x={-6} />
    <Nudger x={0} />
    <Nudger x={6} />

    <Tag position={[-6, 4.5, 0]}>slides on X only</Tag>
    <Tag position={[0, 4.5, 0]}>turns about Y only</Tag>
    <Tag position={[6, 4.5, 0]}>both, with friction on the slide</Tag>
  </>
);
