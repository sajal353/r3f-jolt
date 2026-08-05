import { useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";
import { useJolt } from "@/Jolt/useJolt";
import type { JoltModule } from "@/Jolt/types";
import { Floor, Hud, Ramp, Wall } from "../../shared/Stage";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "crouch", keys: ["ShiftLeft", "ShiftRight"] },
];

const MAX_SLOPE_DEGREES = 45;
const SLOPES = [20, 33, 43, 52, 62];

const RAMP_LENGTH = 9;
const RAMP_WIDTH = 5;
const RAMP_FOOT = -4;

const STANDING = { height: 1.3, radius: 0.35 };
const CROUCHING = { height: 0.4, radius: 0.35 };

const SPAWN: [number, number, number] = [0, 3, 8];

const Slopes = () => (
  <>
    {SLOPES.map((degrees, index) => {
      const x = (index - (SLOPES.length - 1) / 2) * (RAMP_WIDTH + 1);

      return (
        <Ramp
          key={degrees}
          degrees={degrees}
          foot={RAMP_FOOT}
          length={RAMP_LENGTH}
          width={RAMP_WIDTH}
          x={x}
          friction={1}
          // Green under the limit, red over it — walk up each and watch the
          // readout flip to "sliding" at the same place the colour changes.
          color={degrees < MAX_SLOPE_DEGREES ? "#2f4f3a" : "#4f2f38"}
        />
      );
    })}
  </>
);

const STEPS = [0.25, 0.5, 0.75, 1];

/** Rises of 0.25 the character walks straight up, then a 1.6 wall it cannot. */
const Stairs = () => (
  <>
    {STEPS.map((height, index) => (
      <Wall
        key={height}
        position={[19, height / 2, 2 - index * 1.4]}
        size={[6, height, 1.4]}
        color="#454545"
      />
    ))}
    <Wall position={[19, 0.8, -6]} size={[6, 1.6, 3]} color="#3a3a3a" />
  </>
);

const Crate = ({ position }: { position: [number, number, number] }) => {
  const [ref] = useBox({
    position,
    size: [0.8, 0.8, 0.8],
    motionType: "dynamic",
    mass: 8,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

/** `maxStrength` is what a character can shove: these move, the stairs do not. */
const Crates = () => (
  <>
    {[0, 1, 2, 3].map((index) => (
      <Crate key={index} position={[-19 + index * 1.1, 0.4, 1 - index * 0.6]} />
    ))}
  </>
);

const PLATFORM_Z = 14;
const PLATFORM_SIZE = 8;
const PLATFORM_REACH = 5;
const PLATFORM_RATE = 0.25;

/**
 * A character standing on a kinematic body is carried by it, because
 * `useCharacter` folds the ground's velocity into its own every step. Drive the
 * platform with `moveKinematic` — setting its transform outright would teleport
 * it with no velocity and leave the character standing where it was.
 */
const Platform = () => {
  const [ref, api] = useBox({
    position: [0, 1.2, PLATFORM_Z],
    size: [PLATFORM_SIZE, 0.4, PLATFORM_SIZE],
    motionType: "kinematic",
    material: { friction: 1 },
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;
    elapsed.current += delta;
    api.moveKinematic(
      [
        Math.sin(elapsed.current * PLATFORM_RATE) * PLATFORM_REACH,
        1.2,
        PLATFORM_Z,
      ],
      [0, 0, 0, 1],
    );
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[PLATFORM_SIZE, 0.4, PLATFORM_SIZE]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Figure = ({
  height,
  radius,
  color,
}: {
  height: number;
  radius: number;
  color: string;
}) => (
  <group position={[0, height / 2 + radius, 0]}>
    <mesh castShadow>
      <capsuleGeometry args={[radius, height, 8, 20]} />
      <meshStandardMaterial color={color} roughness={0.45} />
    </mesh>
    {/* A capsule is rotationally symmetric, so which way it faces has to be
        drawn on. */}
    <mesh position={[0, height / 2 + radius * 0.3, radius * 0.9]} castShadow>
      <boxGeometry args={[radius * 1.1, radius * 0.34, radius * 0.5]} />
      <meshStandardMaterial color="#101010" roughness={0.3} />
    </mesh>
  </group>
);

const groundLabel = (jolt: JoltModule, state: number) => {
  if (state === jolt.EGroundState_OnGround) return "on ground";
  if (state === jolt.EGroundState_OnSteepGround) return "too steep — sliding";
  if (state === jolt.EGroundState_NotSupported) return "not supported";

  return "in air";
};

/** Turn the short way round, so reversing spins rather than snapping. */
const turnTowards = (current: number, target: number, delta: number) => {
  const difference =
    ((((target - current) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) -
    Math.PI;

  return current + difference * Math.min(1, delta * 12);
};

const Player = () => {
  const { Jolt } = useJolt();

  const [api] = useCharacter({
    position: SPAWN,
    options: {
      height: { standing: STANDING.height, crouching: CROUCHING.height },
      radius: { standing: STANDING.radius, crouching: CROUCHING.radius },
      moveSpeed: 6,
      jumpSpeed: 6.5,
      maxSlopeAngle: MAX_SLOPE_DEGREES * (Math.PI / 180),
    },
  });

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);

  const rootRef = useRef<Group>(null);
  const standingRef = useRef<Group>(null);
  const crouchingRef = useRef<Group>(null);

  const [ground, setGround] = useState("in air");

  const scratch = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(0, 1, 0),
    yaw: Math.PI,
    sampled: 0,
  });

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;
    const state = scratch.current;
    const { direction, forward, right, up } = state;

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

    const crouched = keys.crouch;
    api.update(direction, keys.jump, crouched, Math.min(delta, 1 / 30));

    const root = rootRef.current;
    if (root) {
      const position = api.character.GetPosition();
      root.position.set(position.GetX(), position.GetY(), position.GetZ());

      if (direction.lengthSq() > 0) {
        state.yaw = Math.atan2(direction.x, direction.z);
      }
      root.rotation.y = turnTowards(root.rotation.y, state.yaw, delta);
    }

    if (standingRef.current) standingRef.current.visible = !crouched;
    if (crouchingRef.current) crouchingRef.current.visible = crouched;

    state.sampled += delta;
    if (state.sampled < 0.15) return;
    state.sampled = 0;

    setGround(groundLabel(Jolt, api.character.GetGroundState()));
  });

  return (
    <>
      <group ref={rootRef}>
        <group ref={standingRef}>
          <Figure {...STANDING} color="#3fa7d6" />
        </group>
        <group ref={crouchingRef} visible={false}>
          <Figure {...CROUCHING} color="#2b7fa3" />
        </group>
      </group>

      <Hud position={[0, 8, 8]}>
        <b>{ground}</b>
      </Hud>
    </>
  );
};

export const Character = () => (
  <KeyboardControls map={controls}>
    <Floor size={60} friction={1} />
    <Slopes />
    <Stairs />
    <Crates />
    <Platform />
    <Player />
  </KeyboardControls>
);
