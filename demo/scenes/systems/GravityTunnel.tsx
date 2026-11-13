import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { Group, Quaternion, Vector3 } from "three";
import { useMannequin } from "../../shared/mannequin";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useJolt } from "@/Jolt/useJolt";
import { useRagdoll, type RagdollApi } from "@/Jolt/useRagdoll";
import { interactionGroups } from "@/Jolt/internal/interactionGroups";
import type { Vec3Tuple } from "@/Jolt/types";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "sprint", keys: ["ShiftLeft", "ShiftRight"] },
];

/** The controller and the ragdoll overlap, so the ragdoll's group is one the controller leaves out. */
const STATIC = 1 << 0;
const MOVING = 1 << 1;
const RAGDOLL = 1 << 2;
const STATIC_LAYER = interactionGroups(STATIC, MOVING | RAGDOLL);

/** A square tunnel along Z, 10 m across inside, closed at both ends. */
const ACROSS = 10;
const HALF = ACROSS / 2;
const LENGTH = 60;
const WALL = 1;

const G = 9.81;
/** Gravity points at one of the four walls, never along the tunnel. */
const PULLS: { label: string; gravity: Vec3Tuple }[] = [
  { label: "floor", gravity: [0, -G, 0] },
  { label: "ceiling", gravity: [0, G, 0] },
  { label: "left wall", gravity: [-G, 0, 0] },
  { label: "right wall", gravity: [G, 0, 0] },
];
const PERIOD = 10;

const MOVE_SPEED = 6.5;
const WALK = 0.4;
/**
 * Falling faster than this along gravity, m/s, goes limp: a drop of 2.5 m. A
 * jump lands slower; a fall across most of the tunnel lands faster.
 */
const FALL_SPEED = 7;
const SETTLE_SECONDS = 1.5;
const MAX_DOWN = 4;

const SPAWN: Vec3Tuple = [0, -HALF, 18];
/** Behind and a little above, looking down the tunnel. It follows, and never turns. */
const CAMERA_OFFSET = new Vector3(0, 1, 9);
/** How far the camera keeps from the walls, so it never ends up inside one. */
const CAMERA_MARGIN = 0.6;
const FOLLOW_RATE = 4;
const HUD_OFFSET = new Vector3(0, 2.6, 0);

/** After the world steps and before the ragdoll reads its pose. */
const RUNNER_PRIORITY = -0.5;

const LOCAL_UP = new Vector3(0, 1, 0);

const Block = ({
  position,
  size,
  color,
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color: string;
}) => {
  const [ref] = useBox({ position, size, motionType: "static", layer: STATIC_LAYER });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/** Each wall its own colour, so it reads which one is underfoot. */
const Tunnel = () => {
  const outer = ACROSS + WALL * 2;
  const away = HALF + WALL / 2;
  const capAt = LENGTH / 2 + WALL / 2;

  return (
    <>
      <Block position={[0, -away, 0]} size={[outer, WALL, LENGTH]} color="#3a3a3a" />
      <Block position={[0, away, 0]} size={[outer, WALL, LENGTH]} color="#33334a" />
      <Block position={[-away, 0, 0]} size={[WALL, ACROSS, LENGTH]} color="#4a3333" />
      <Block position={[away, 0, 0]} size={[WALL, ACROSS, LENGTH]} color="#334a33" />
      <Block position={[0, 0, -capAt]} size={[outer, outer, WALL]} color="#2a2a2a" />
      <Block position={[0, 0, capAt]} size={[outer, outer, WALL]} color="#2a2a2a" />
    </>
  );
};

/** Turn the short way round, so reversing spins rather than snapping. */
const turnTowards = (current: number, target: number, delta: number) => {
  const difference =
    ((((target - current) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) -
    Math.PI;
  return current + difference * Math.min(1, delta * 10);
};

type Gait = "Idle_Loop" | "Walk_Loop" | "Sprint_Loop" | "Jump_Loop";

/** Every `PERIOD` seconds, gravity jumps to a wall it is not already on. */
const useGravityClock = () => {
  const { physicsSystem, temps } = useJolt();
  const clock = useRef({ elapsed: 0, pull: 0 });
  const [shown, setShown] = useState({ left: PERIOD, label: PULLS[0].label });

  useFrame((_, delta) => {
    const now = clock.current;
    now.elapsed += Math.min(delta, 0.1);

    if (now.elapsed >= PERIOD) {
      now.elapsed = 0;
      const others = PULLS.map((_, index) => index).filter((index) => index !== now.pull);
      now.pull = others[Math.floor(Math.random() * others.length)];
      physicsSystem.SetGravity(temps.vec3(PULLS[now.pull].gravity));
    }

    const left = Math.ceil(PERIOD - now.elapsed);
    const label = PULLS[now.pull].label;
    if (left !== shown.left || label !== shown.label) setShown({ left, label });
  });

  return shown;
};

const Runner = () => {
  const { temps, physicsSystem } = useJolt();
  const { character, mixer, play, place, getUp } = useMannequin(SPAWN, "Idle_Loop");
  const model = useCharacterModel(character);
  const [ragdoll] = useRagdoll(model, {
    mode: "hardKeying",
    mixer,
    group: RAGDOLL,
    mask: STATIC | MOVING,
  });

  const [controller] = useCharacter({
    position: SPAWN,
    options: {
      height: { standing: 1.1, crouching: 1.1 },
      radius: { standing: 0.35, crouching: 0.35 },
      moveSpeed: MOVE_SPEED,
      jumpSpeed: 6,
    },
  });

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);
  const orbit = useThree((state) => state.controls) as unknown as {
    target: Vector3;
  } | null;
  const hudRef = useRef<Group>(null);
  const { left, label } = useGravityClock();

  const state = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    local: new Vector3(),
    velocity: new Vector3(),
    rotation: new Quaternion(),
    inverse: new Quaternion(),
    upright: new Quaternion(),
    followed: new Vector3(),
    pelvis: new Vector3(),
    moved: new Vector3(),
    eye: new Vector3(),
    yaw: 0,
    facing: 0,
    gait: "Idle_Loop" as Gait,
    /** Seconds limp, or null on its feet. */
    down: null as number | null,
    gettingUp: false,
  });

  // Behind the character, looking down the tunnel; put back when the scene goes.
  useEffect(() => {
    const start = camera.position.clone();
    const target = orbit?.target.clone();
    const spawn = new Vector3(...SPAWN);

    state.current.followed.copy(spawn).add(LOCAL_UP);
    camera.position.copy(state.current.followed).add(CAMERA_OFFSET);
    orbit?.target.copy(state.current.followed);

    return () => {
      camera.position.copy(start);
      if (target) orbit?.target.copy(target);
    };
  }, [camera, orbit]);

  const [pelvisBone] = useState(() => character.getObjectByName("pelvis")!);

  /**
   * The drawn pelvis, eased. The camera sits at a fixed offset from it, kept
   * inside the tunnel, and its target moves with it, so it never turns.
   */
  const follow = (delta: number) => {
    const now = state.current;
    pelvisBone.getWorldPosition(now.pelvis);
    now.moved
      .subVectors(now.pelvis, now.followed)
      .multiplyScalar(1 - Math.exp(-FOLLOW_RATE * delta));
    now.followed.add(now.moved);

    const inside = HALF - CAMERA_MARGIN;
    now.eye.copy(now.followed).add(CAMERA_OFFSET);
    now.eye.x = Math.min(inside, Math.max(-inside, now.eye.x));
    now.eye.y = Math.min(inside, Math.max(-inside, now.eye.y));
    now.eye.z = Math.min(LENGTH / 2 - CAMERA_MARGIN, now.eye.z);

    orbit?.target.add(now.moved.subVectors(now.eye, camera.position));
    camera.position.copy(now.eye);
    hudRef.current?.position.copy(now.followed).add(HUD_OFFSET);
  };

  /** Up is against gravity, wherever gravity points now. */
  const gravityUp = (target: Vector3) => {
    const pull = physicsSystem.GetGravity();
    return target.set(-pull.GetX(), -pull.GetY(), -pull.GetZ()).normalize();
  };

  const goLimp = (api: RagdollApi) => {
    const now = state.current;
    api.setMode("passive");
    api.setLinearVelocity(now.velocity);
    now.down = 0;
    now.gettingUp = false;
  };

  const standUp = (api: RagdollApi) => {
    const now = state.current;
    now.upright.setFromUnitVectors(LOCAL_UP, gravityUp(now.up));
    const plan = getUp(
      api,
      "Idle_Loop",
      function stood() {
        state.current.gettingUp = false;
      },
      now.upright,
    );

    // The controller waited where it went limp; it stands where the get-up
    // does, already turned to this gravity.
    const lift = now.up.clone().multiplyScalar(0.05).add(plan.position);
    controller!.character.SetPosition(temps.rvec3([lift.x, lift.y, lift.z]));
    controller!.character.SetRotation(
      temps.quat([now.upright.x, now.upright.y, now.upright.z, now.upright.w]),
    );
    controller!.character.SetLinearVelocity(temps.vec3([0, 0, 0]));
    now.velocity.set(0, 0, 0);
    now.yaw = plan.yaw;
    now.facing = plan.yaw;
    now.gait = "Idle_Loop";
    now.down = null;
    now.gettingUp = true;
  };

  const bodySettled = (api: RagdollApi) => {
    const now = state.current;
    return (
      now.down !== null &&
      now.down >= SETTLE_SECONDS &&
      (!api.isActive() || now.down >= MAX_DOWN)
    );
  };

  useFrame(function run(_, delta) {
    if (!controller || !ragdoll) return;
    const now = state.current;

    follow(delta);

    if (now.down !== null) {
      now.down += delta;
      if (bodySettled(ragdoll)) standUp(ragdoll);
      return;
    }

    const keys = getKeys() as Record<string, boolean>;
    const { direction, forward, right, up, local, rotation, inverse } = now;

    const turn = controller.character.GetRotation();
    rotation.set(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW());
    up.copy(LOCAL_UP).applyQuaternion(rotation);

    // Forward is down the tunnel as the camera sees it, flattened onto
    // whatever the feet stand on; right is to the character's own right.
    camera.getWorldDirection(forward);
    forward.addScaledVector(up, -forward.dot(up)).normalize();
    right.crossVectors(forward, up).normalize();

    const planted = controller.character.IsSupported();
    direction.set(0, 0, 0);
    if (planted && !now.gettingUp) {
      if (keys.forward) direction.add(forward);
      if (keys.backward) direction.sub(forward);
      if (keys.right) direction.add(right);
      if (keys.left) direction.sub(right);
      if (direction.lengthSq() > 0) {
        direction.normalize().multiplyScalar(keys.sprint ? 1 : WALK);
      }
    }
    const moving = direction.lengthSq() > 0;
    const jumping = planted && !now.gettingUp && keys.jump;

    controller.update(direction, jumping, false, Math.min(delta, 1 / 30));

    const velocity = controller.character.GetLinearVelocity();
    now.velocity.set(velocity.GetX(), velocity.GetY(), velocity.GetZ());
    const falling = -now.velocity.dot(gravityUp(local));
    if (!controller.character.IsSupported() && falling > FALL_SPEED) {
      goLimp(ragdoll);
      return;
    }

    // The facing turns about the character's own up, so the walking direction
    // is read in its frame.
    if (moving && !now.gettingUp) {
      local.copy(direction).applyQuaternion(inverse.copy(rotation).invert());
      now.yaw = Math.atan2(local.x, local.z);
    }
    now.facing = turnTowards(now.facing, now.yaw, delta);
    const at = controller.character.GetPosition();
    place(at.GetX(), at.GetY(), at.GetZ(), now.facing, rotation);

    if (now.gettingUp) return;

    const gait: Gait = !controller.character.IsSupported()
      ? "Jump_Loop"
      : !moving
        ? "Idle_Loop"
        : keys.sprint
          ? "Sprint_Loop"
          : "Walk_Loop";
    if (gait !== now.gait) {
      now.gait = gait;
      play(gait, 0.25);
    }
  }, RUNNER_PRIORITY);

  return (
    <>
      <primitive object={character} />
      <group ref={hudRef}>
        <Html center className="hud">
          gravity turns in <b>{left}</b> · towards the {label}
        </Html>
      </group>
    </>
  );
};

export const GravityTunnel = () => (
  <KeyboardControls map={controls}>
    <Tunnel />
    <Runner />
  </KeyboardControls>
);
