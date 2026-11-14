import { useEffect, useRef, useState } from "react";
import { Group, Quaternion, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useCharacter } from "@/Jolt/useCharacter";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useJolt } from "@/Jolt/useJolt";
import { useRagdoll } from "@/Jolt/useRagdoll";
import type { Vec3Tuple } from "@/Jolt/types";
import { Controls, Wall } from "../../shared/Stage";
import { Figure } from "../../shared/Figure";
import { turnTowards } from "../../shared/helpers";
import { useMannequin } from "../../shared/mannequin";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
];

const ROOM = 12;
const HALF = ROOM / 2;
const G = 9.81;

/** Every way but towards the camera, which is the open side of the room. */
const PULLS: { label: string; gravity: Vec3Tuple }[] = [
  { label: "down", gravity: [0, -G, 0] },
  { label: "up", gravity: [0, G, 0] },
  { label: "left", gravity: [-G, 0, 0] },
  { label: "right", gravity: [G, 0, 0] },
  { label: "back", gravity: [0, 0, -G] },
];

const BODY = { height: 1.3, radius: 0.35 };
/** Down at least this long, s, then up once asleep, or at `MAX_DOWN` regardless. */
const SETTLE_SECONDS = 1.5;
const MAX_DOWN = 4;
const LOCAL_UP = new Vector3(0, 1, 0);
const VIEW: Vec3Tuple = [0, HALF, ROOM * 2.2];
const CENTRE: Vec3Tuple = [0, HALF, 0];

/** A box open at the front, so the camera looks in. */
const Room = () => (
  <>
    <Wall position={[0, -0.5, 0]} size={[ROOM + 2, 1, ROOM + 2]} friction={1} />
    <Wall position={[0, ROOM + 0.5, 0]} size={[ROOM + 2, 1, ROOM + 2]} friction={1} color="#33333d" />
    <Wall position={[-HALF - 0.5, HALF, 0]} size={[1, ROOM, ROOM + 2]} friction={1} color="#3d3333" />
    <Wall position={[HALF + 0.5, HALF, 0]} size={[1, ROOM, ROOM + 2]} friction={1} color="#333d33" />
    <Wall position={[0, HALF, -HALF - 0.5]} size={[ROOM, ROOM, 1]} friction={1} color="#3a3a3a" />
  </>
);

const useRoomCamera = () => {
  const camera = useThree((state) => state.camera);
  const orbit = useThree((state) => state.controls) as unknown as {
    target: Vector3;
  } | null;

  useEffect(() => {
    const start = camera.position.clone();
    const target = orbit?.target.clone();

    camera.position.set(...VIEW);
    orbit?.target.set(...CENTRE);

    return () => {
      camera.position.copy(start);
      if (target) orbit?.target.copy(target);
    };
  }, [camera, orbit]);
};

const Player = () => {
  const [api] = useCharacter({
    position: [0, 1, 2],
    options: {
      height: { standing: BODY.height, crouching: BODY.height },
      radius: { standing: BODY.radius, crouching: BODY.radius },
      moveSpeed: 5,
      jumpSpeed: 6,
    },
  });

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);
  const bodyRef = useRef<Group>(null);
  const facingRef = useRef<Group>(null);

  const scratch = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
    local: new Vector3(),
    rotation: new Quaternion(),
    inverse: new Quaternion(),
    yaw: 0,
  });

  useFrame((_, delta) => {
    if (!api) return;

    const keys = getKeys() as Record<string, boolean>;
    const state = scratch.current;
    const { direction, forward, right, up, local, rotation, inverse } = state;

    const turn = api.character.GetRotation();
    rotation.set(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW());
    up.set(0, 1, 0).applyQuaternion(rotation);

    // Walking runs across whatever the feet stand on, so the camera's view is
    // flattened onto the plane square to the character's up, not onto the floor.
    camera.getWorldDirection(forward);
    forward.addScaledVector(up, -forward.dot(up));
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    direction.set(0, 0, 0);
    if (keys.forward) direction.add(forward);
    if (keys.backward) direction.sub(forward);
    if (keys.right) direction.add(right);
    if (keys.left) direction.sub(right);
    if (direction.lengthSq() > 0) direction.normalize();

    api.update(direction, keys.jump, false, Math.min(delta, 1 / 30));

    const body = bodyRef.current;
    if (body) {
      const position = api.character.GetPosition();
      body.position.set(position.GetX(), position.GetY(), position.GetZ());
      body.quaternion.copy(rotation);
    }

    // The figure turns to face where it walks, about its own up, so the
    // direction is read in the character's frame.
    if (direction.lengthSq() > 0) {
      local.copy(direction).applyQuaternion(inverse.copy(rotation).invert());
      state.yaw = Math.atan2(local.x, local.z);
    }
    const facing = facingRef.current;
    if (facing) facing.rotation.y = turnTowards(facing.rotation.y, state.yaw, delta);
  });

  return (
    <group ref={bodyRef}>
      <group ref={facingRef}>
        <Figure {...BODY} color="#3fa7d6" />
      </group>
    </group>
  );
};

/**
 * Stands idle, hard keyed. When gravity turns it goes limp, falls to the new
 * floor and gets up on it: the get-up is planned with gravity's up in place of +Y.
 */
const Mannequin = ({ pulls }: { pulls: number }) => {
  const { physicsSystem } = useJolt();
  const { character, mixer, getUp } = useMannequin([3, 0, -1], "Idle_Loop", [0, -0.6, 0]);
  const model = useCharacterModel(character);
  const [ragdoll] = useRagdoll(model, { mode: "hardKeying", mixer });
  const down = useRef<number | null>(null);
  const [scratch] = useState(() => ({ up: new Vector3(), upright: new Quaternion() }));

  useEffect(() => {
    if (pulls === 0 || !ragdoll) return;
    ragdoll.setMode("passive");
    ragdoll.activate();
    down.current = 0;
  }, [pulls, ragdoll]);

  useFrame(function getUpWhenSettled(_, delta) {
    if (down.current === null || !ragdoll) return;
    down.current += delta;
    if (down.current < SETTLE_SECONDS) return;
    if (ragdoll.isActive() && down.current < MAX_DOWN) return;

    down.current = null;
    const pull = physicsSystem.GetGravity();
    scratch.up.set(-pull.GetX(), -pull.GetY(), -pull.GetZ()).normalize();
    scratch.upright.setFromUnitVectors(LOCAL_UP, scratch.up);
    getUp(ragdoll, "Idle_Loop", undefined, scratch.upright);
  });

  return <primitive object={character} />;
};

const Switches = ({ onPull }: { onPull: () => void }) => {
  const { physicsSystem, temps } = useJolt();
  const [pulling, setPulling] = useState("down");

  const pull = (label: string, gravity: Vec3Tuple) => {
    if (label === pulling) return;
    physicsSystem.SetGravity(temps.vec3(gravity));
    setPulling(label);
    onPull();
  };

  return (
    <Controls position={[0, -1.4, HALF + 1]}>
      {PULLS.map(({ label, gravity }) => (
        <button
          key={label}
          type="button"
          aria-pressed={pulling === label}
          onClick={() => pull(label, gravity)}
        >
          {label}
        </button>
      ))}
    </Controls>
  );
};

export const Gravity = () => {
  useRoomCamera();
  const [pulls, setPulls] = useState(0);

  return (
    <KeyboardControls map={controls}>
      <Room />
      <Player />
      <Mannequin pulls={pulls} />
      <Switches onPull={() => setPulls((count) => count + 1)} />
    </KeyboardControls>
  );
};
