import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Color } from "three";
import { Floor, Hud, Wall } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useJolt } from "@/Jolt/useJolt";
import { useInstancedBodies } from "@/Jolt/useInstancedBodies";
import type { ColliderDescriptor } from "@/Jolt/internal/colliderShape";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const PER_KIND = 150;
const ARENA = 30;
const DROP_HEIGHT = 26;
const FLOOR_OUT = -6;
const UPRIGHT: QuatTuple = [0, 0, 0, 1];

const scatter = () => (Math.random() - 0.5) * (ARENA - 6);

const spawn = () => ({
  position: [scatter(), DROP_HEIGHT * Math.random(), scatter()] as Vec3Tuple,
});

const KINDS: { name: string; color: string; collider: ColliderDescriptor }[] = [
  {
    name: "box",
    color: "#8e44ad",
    collider: { type: "box", size: [0.6, 0.6, 0.6] },
  },
  {
    name: "sphere",
    color: "#2980b9",
    collider: { type: "sphere", radius: 0.35 },
  },
  {
    name: "capsule",
    color: "#16a085",
    collider: { type: "capsule", height: 0.6, radius: 0.22 },
  },
  {
    name: "cylinder",
    color: "#27ae60",
    collider: { type: "cylinder", height: 0.6, radius: 0.3 },
  },
  {
    name: "tapered capsule",
    color: "#d35400",
    collider: {
      type: "taperedCapsule",
      height: 0.6,
      topRadius: 0.1,
      bottomRadius: 0.4,
    },
  },
  {
    name: "convex hull",
    color: "#c0392b",
    collider: {
      type: "convex",
      vertices: [
        [0, 0.5, 0],
        [-0.4, 0, -0.4],
        [0.4, 0, -0.4],
        [0.4, 0, 0.4],
        [-0.4, 0, 0.4],
        [0, -0.5, 0],
      ],
    },
  },
  {
    name: "compound",
    color: "#f39c12",
    collider: {
      type: "compound",
      shapes: [
        { type: "box", position: [0, 0, 0], size: [0.9, 0.24, 0.24] },
        { type: "sphere", position: [0, 0.35, 0], radius: 0.2 },
      ],
    },
  },
];

/**
 * One draw call and one Jolt shape for 150 bodies. The hook owns the shape, the
 * batch add and the per-frame write-back; the scene owns what the scene is
 * about.
 */
const Kind = ({
  collider,
  color,
}: {
  collider: ColliderDescriptor;
  color: string;
}) => {
  const [ref, swarm] = useInstancedBodies({
    count: PER_KIND,
    collider,
    transforms: spawn,
    motionType: "dynamic",
    material: { friction: 0.4, restitution: 0.2 },
  });

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || !swarm) return;

    const shade = new Color();

    for (let index = 0; index < swarm.count; index += 1) {
      shade.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.25);
      mesh.setColorAt(index, shade);
    }

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [ref, swarm, color]);

  useFrame(() => {
    if (!swarm) return;

    // Anything that bounces out of the pit goes back on top rather than being
    // deleted, so the body count — and the cost — stays flat for as long as the
    // scene runs.
    for (let index = 0; index < swarm.count; index += 1) {
      const body = swarm.bodies[index];
      if (!body.IsActive()) continue;
      if (body.GetPosition().GetY() > FLOOR_OUT) continue;

      swarm
        .at(index)
        ?.setPositionAndRotation(
          [scatter(), DROP_HEIGHT, scatter()],
          UPRIGHT,
        );
    }
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, PER_KIND]}
      // Every instance moves, so the bounds computed at creation are a lie.
      frustumCulled={false}
      // No `castShadow`: a shadow map draws every caster a second time, and a
      // thousand of them buys very little in a pit lit from above.
      receiveShadow
    >
      <meshStandardMaterial />
    </instancedMesh>
  );
};

/** Kinematic, and the only body in the scene that is not instanced. */
const Paddle = () => {
  const [ref, api] = useBox({
    position: [0, 1.2, 0],
    size: [ARENA - 6, 2.4, 1.2],
    motionType: "kinematic",
    material: { friction: 0.9 },
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    api.moveKinematic([0, 1.2, Math.sin(elapsed.current * 0.5) * 9], UPRIGHT);
  });

  return (
    <mesh ref={ref} position={[0, 1.2, 0]} castShadow>
      <boxGeometry args={[ARENA - 6, 2.4, 1.2]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Readout = () => {
  const { Jolt: jolt, physicsSystem, state } = useJolt();
  const [line, setLine] = useState("starting up");

  const elapsed = useRef(0);
  const frames = useRef(0);

  useFrame((_, delta) => {
    if (state.disposed) return;

    elapsed.current += delta;
    frames.current += 1;

    if (elapsed.current < 0.4) return;

    setLine(
      `${Math.round(frames.current / elapsed.current)} fps · ` +
        `${physicsSystem.GetNumBodies()} bodies, ` +
        `${physicsSystem.GetNumActiveBodies(jolt.EBodyType_RigidBody)} awake · ` +
        `${KINDS.length} draw calls`,
    );

    elapsed.current = 0;
    frames.current = 0;
  });

  return <Hud position={[0, 8, 0]}>{line}</Hud>;
};

export const Instancing = () => (
  <>
    <Floor size={ARENA} friction={0.6} />
    <Wall position={[0, 3, -ARENA / 2]} size={[ARENA, 6, 1]} />
    <Wall position={[0, 3, ARENA / 2]} size={[ARENA, 6, 1]} />
    <Wall position={[-ARENA / 2, 3, 0]} size={[1, 6, ARENA]} />
    <Wall position={[ARENA / 2, 3, 0]} size={[1, 6, ARENA]} />

    <Paddle />
    {KINDS.map(({ name, collider, color }) => (
      <Kind key={name} collider={collider} color={color} />
    ))}
    <Readout />
  </>
);
