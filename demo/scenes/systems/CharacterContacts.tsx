import { useEffect, useRef, useState } from "react";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useCylinder } from "@/Jolt/useCylinder";
import { useSphere } from "@/Jolt/useSphere";
import { useConveyor } from "@/Jolt/useConveyor";
import { useCharacter } from "@/Jolt/useCharacter";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";
import { Hud, Tag } from "../../shared/Stage";
import { Figure } from "../../shared/Figure";
import { turnTowards } from "../../shared/helpers";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
];

const SIZE = { height: 1.3, radius: 0.35 };
const CHARACTER_OPTIONS = {
  height: { standing: SIZE.height, crouching: SIZE.height },
  radius: { standing: SIZE.radius, crouching: SIZE.radius },
  jumpSpeed: 6.5,
};

const PLAYER = 1;
const NPC_COLOR = "#8e9aa6";
const TOUCHED_COLOR = "#e67e22";

const BELT_SPEED = 3;
const TURNTABLE_SPIN = 0.8;
const TURNTABLE_RADIUS = 4;
const TURNTABLE_AT: Vec3Tuple = [-10, 0.1, 0];

const BALL_EVERY = 1.2;
const BALL_CAP = 16;

/** Which body is which, for the player's readout. */
const names = new Map<number, string>();

const useNamed = (api: BodyApi<Jolt.Shape> | undefined, name: string) => {
  useEffect(() => {
    if (!api) return;
    const id = api.body.GetID().GetIndexAndSequenceNumber();
    names.set(id, name);
    return () => {
      names.delete(id);
    };
  }, [api, name]);
};

const Ground = () => {
  const [ref, api] = useBox({
    position: [0, -0.5, 0],
    size: [50, 1, 50],
    motionType: "static",
    material: { friction: 1 },
  });
  useNamed(api, "floor");

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[50, 1, 50]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  );
};

const Belt = () => {
  const size: Vec3Tuple = [3, 0.2, 14];
  const [ref, api] = useBox({
    position: [10, 0.1, 0],
    size,
    motionType: "static",
  });
  useConveyor(api, { linear: [0, 0, -BELT_SPEED] });
  useNamed(api, "belt");

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#2c3e50" />
    </mesh>
  );
};

/** The body stays put; only the markers on it turn, at the rate it carries. */
const Turntable = () => {
  const [ref, api] = useCylinder({
    position: TURNTABLE_AT,
    radius: TURNTABLE_RADIUS,
    height: 0.2,
    motionType: "static",
  });
  useConveyor(api, { angular: [0, TURNTABLE_SPIN, 0] });
  useNamed(api, "turntable");

  const markers = useRef<Group>(null);

  useFrame(function spin(_, delta) {
    if (markers.current) markers.current.rotation.y += TURNTABLE_SPIN * delta;
  });

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <cylinderGeometry args={[TURNTABLE_RADIUS, TURNTABLE_RADIUS, 0.2, 48]} />
        <meshStandardMaterial color="#34495e" />
      </mesh>
      <group ref={markers} position={[TURNTABLE_AT[0], 0.21, TURNTABLE_AT[2]]}>
        {[0, 1, 2, 3].map((index) => (
          <mesh key={index} rotation={[0, (index * Math.PI) / 2, 0]}>
            <boxGeometry args={[0.2, 0.02, TURNTABLE_RADIUS * 1.8]} />
            <meshStandardMaterial color="#5d6d7e" />
          </mesh>
        ))}
      </group>
    </>
  );
};

const Ball = ({ position }: { position: Vec3Tuple }) => {
  const [ref, api] = useSphere({
    radius: 0.25,
    position,
    motionType: "dynamic",
    mass: 1,
    material: { restitution: 0.5 },
  });
  useNamed(api, "ball");

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.4} roughness={0.3} />
    </mesh>
  );
};

/** Paces back and forth along x; turns orange while the player touches it. */
const Npc = ({ z, phase }: { z: number; phase: number }) => {
  const material = useRef<MeshStandardMaterial>(null);
  const root = useRef<Group>(null);

  const [api] = useCharacter({
    position: [-6 + phase * 4, 0, z],
    userData: 100 + phase,
    options: { ...CHARACTER_OPTIONS, moveSpeed: 2 },
    onCharacterContactAdded: function touched(contact) {
      if (contact.userData === PLAYER) material.current?.color.set(TOUCHED_COLOR);
    },
    onCharacterContactRemoved: function released(contact) {
      if (contact.userData === PLAYER) material.current?.color.set(NPC_COLOR);
    },
  });

  const state = useRef({ direction: new Vector3(1, 0, 0), yaw: Math.PI / 2 });

  useFrame(function pace(_, delta) {
    if (!api) return;
    const { direction } = state.current;
    const x = api.character.GetPosition().GetX();
    if (x > 6) direction.set(-1, 0, 0);
    if (x < -6) direction.set(1, 0, 0);

    api.update(direction, false, false, Math.min(delta, 1 / 30));

    const position = api.character.GetPosition();
    root.current?.position.set(position.GetX(), position.GetY(), position.GetZ());
    if (root.current) {
      state.current.yaw = Math.atan2(direction.x, direction.z);
      root.current.rotation.y = turnTowards(
        root.current.rotation.y,
        state.current.yaw,
        delta,
      );
    }
  });

  return (
    <group ref={root}>
      <Figure {...SIZE} color={NPC_COLOR} material={material} />
    </group>
  );
};

const Player = ({ onMoved }: { onMoved: (at: Vector3) => void }) => {
  const touching = useRef(new Map<string, number>());
  const [readout, setReadout] = useState("nothing");

  const count = (name: string, change: number) => {
    const next = (touching.current.get(name) ?? 0) + change;
    if (next > 0) touching.current.set(name, next);
    else touching.current.delete(name);
  };

  const [api] = useCharacter({
    position: [0, 1, 6],
    userData: PLAYER,
    innerBody: true,
    options: CHARACTER_OPTIONS,
    onContactAdded: (contact) => count(names.get(contact.bodyID) ?? "?", 1),
    onContactRemoved: (contact) => count(names.get(contact.bodyID) ?? "?", -1),
    onCharacterContactAdded: (contact) => count(`npc ${contact.userData - 99}`, 1),
    onCharacterContactRemoved: (contact) =>
      count(`npc ${contact.userData - 99}`, -1),
  });

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);
  const root = useRef<Group>(null);

  const scratch = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(0, 1, 0),
    at: new Vector3(),
    yaw: Math.PI,
    sampled: 0,
  });

  useFrame(function drive(_, delta) {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;
    const state = scratch.current;
    const { direction, forward, right, up, at } = state;

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    direction.set(0, 0, 0);
    if (keys.forward) direction.add(forward);
    if (keys.backward) direction.sub(forward);
    if (keys.right) direction.add(right);
    if (keys.left) direction.sub(right);
    if (direction.lengthSq() > 0) direction.normalize();

    api.update(direction, keys.jump, false, Math.min(delta, 1 / 30));

    const position = api.character.GetPosition();
    at.set(position.GetX(), position.GetY(), position.GetZ());
    onMoved(at);

    if (root.current) {
      root.current.position.copy(at);
      if (direction.lengthSq() > 0) {
        state.yaw = Math.atan2(direction.x, direction.z);
      }
      root.current.rotation.y = turnTowards(
        root.current.rotation.y,
        state.yaw,
        delta,
      );
    }

    state.sampled += delta;
    if (state.sampled < 0.15) return;
    state.sampled = 0;
    const list = [...touching.current.keys()].sort().join(" · ");
    setReadout(list || "nothing");
  });

  return (
    <>
      <group ref={root}>
        <Figure {...SIZE} color="#3fa7d6" />
      </group>
      <Hud position={[0, 7, 6]}>
        touching <b>{readout}</b>
      </Hud>
    </>
  );
};

/** Drops a ball over wherever the player stands, to land on its inner body. */
const useBallRain = () => {
  const [balls, setBalls] = useState<{ id: number; position: Vec3Tuple }[]>([]);
  const player = useRef(new Vector3(0, 0, 6));
  const since = useRef(0);
  const nextID = useRef(0);

  useFrame(function drop(_, delta) {
    since.current += delta;
    if (since.current < BALL_EVERY) return;
    since.current = 0;
    nextID.current += 1;
    const { x, z } = player.current;
    const ball = {
      id: nextID.current,
      position: [
        x + (Math.random() - 0.5) * 0.4,
        6,
        z + (Math.random() - 0.5) * 0.4,
      ] as Vec3Tuple,
    };
    setBalls((current) => [
      ...current.slice(Math.max(0, current.length - (BALL_CAP - 1))),
      ball,
    ]);
  });

  const follow = (at: Vector3) => player.current.copy(at);
  return { balls, follow };
};

export const CharacterContacts = () => {
  const { balls, follow } = useBallRain();

  return (
    <KeyboardControls map={controls}>
      <Ground />
      <Belt />
      <Turntable />
      <Npc z={-2} phase={0} />
      <Npc z={-4} phase={1} />
      <Npc z={-6} phase={2} />
      <Player onMoved={follow} />
      {balls.map((ball) => (
        <Ball key={ball.id} position={ball.position} />
      ))}

      <Tag position={[10, 1, 7.5]}>belt</Tag>
      <Tag position={[TURNTABLE_AT[0], 1, TURNTABLE_AT[2] + 4.5]}>
        turntable
      </Tag>
    </KeyboardControls>
  );
};
