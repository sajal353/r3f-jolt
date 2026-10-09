import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { DoubleSide, Vector3 } from "three";
import { useMannequin } from "../../shared/mannequin";
import { chestFacesUp } from "../../shared/animation";
import { CAPE_BONE, createCape, createCapeTexture } from "../../shared/cape";
import { useBox } from "@/Jolt/useBox";
import { useCharacter } from "@/Jolt/useCharacter";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useJolt } from "@/Jolt/useJolt";
import { useRagdoll, type RagdollApi } from "@/Jolt/useRagdoll";
import { useSoftBody } from "@/Jolt/useSoftBody";
import { useSoftBodyContactListener } from "@/Jolt/useSoftBodyContactListener";
import { interactionGroups } from "@/Jolt/internal/interactionGroups";
import type { Vec3Tuple } from "@/Jolt/types";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "sprint", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "ragdoll", keys: ["KeyR"] },
];

/**
 * The controller and the ragdoll overlap by design, so they must not collide:
 * the ragdoll gets a group of its own that the controller's mask leaves out.
 * Everything else the ragdoll should land on or knock over takes it in, the
 * cape included — but see `capeTouches`.
 */
const STATIC = 1 << 0;
const MOVING = 1 << 1;
const RAGDOLL = 1 << 2;
const CLOTH = 1 << 3;
const STATIC_LAYER = interactionGroups(STATIC, MOVING | RAGDOLL | CLOTH);
const CRATE_LAYER = interactionGroups(MOVING, STATIC | MOVING | RAGDOLL | CLOTH);
const CLOTH_LAYER = interactionGroups(CLOTH, STATIC | MOVING | RAGDOLL);
/** The ragdoll bodies the cape rests against while the character is on its feet. */
const TORSO = /pelvis|spine/;

const MOVE_SPEED = 6.5;
const WALK = 0.4;
/**
 * Falling faster than this, m/s, goes limp in the air — about 3.3 m of drop,
 * so a jump on the flat never does, and stepping off the ledge always does.
 */
const FALL_SPEED = 8;
/** Limp from a fall gets up once the body has settled, or after `MAX_DOWN` regardless. */
const SETTLE_SECONDS = 1.5;
const MAX_DOWN = 4;
/**
 * How quickly the camera catches up, per second, across and up: slower up and
 * down, so a collapse, a get-up or a jump does not bob the view.
 */
const FOLLOW_ACROSS = 8;
const FOLLOW_UP = 2.5;

/**
 * After the world steps (-1) and before the ragdoll reads its pose (0), so the
 * kinematic bodies follow where the character is this frame, not the last.
 */
const RUNNER_PRIORITY = -0.5;

const Block = ({
  position,
  size,
  color = "#3a3a3a",
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color?: string;
}) => {
  const [ref] = useBox({ position, size, motionType: "static", layer: STATIC_LAYER });

  return (
    <mesh ref={ref} receiveShadow castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Crate = ({ position }: { position: Vec3Tuple }) => {
  const [ref] = useBox({
    position,
    size: [0.8, 0.8, 0.8],
    motionType: "dynamic",
    mass: 6,
    layer: CRATE_LAYER,
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

/** A floor, walls to run into, crates, and a 5 m ledge up a ramp to jump off. */
const Arena = () => (
  <>
    <Block position={[0, -0.5, 0]} size={[40, 1, 40]} color="#2a2a2a" />
    <Block position={[0, 1, -12]} size={[14, 2, 0.6]} />
    <Block position={[-12, 1, 0]} size={[0.6, 2, 14]} />
    <Block position={[10, 2.5, 6]} size={[6, 5, 6]} color="#454545" />
    <Ramp />
    {[0, 1, 2, 3, 4].map((index) => (
      <Crate key={index} position={[-6 + index * 0.9, 0.4 + (index % 2) * 0.8, -6]} />
    ))}
  </>
);

/** Up to the ledge's top: 5 m over 12, along +Z. */
const Ramp = () => {
  const length = 13;
  const thickness = 0.3;
  // Negative about X lifts the +Z end, toward the ledge.
  const angle = -Math.atan2(5, 12);
  // Down by half the slab's slanted thickness, so the top surface runs flush
  // from the floor to the ledge and a sprint does not catch on a lip.
  const sink = thickness / 2 / Math.cos(angle);
  const [ref] = useBox({
    position: [10, 2.5 - sink, -3],
    rotation: [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)],
    size: [3, thickness, length],
    motionType: "static",
    layer: STATIC_LAYER,
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[3, thickness, length]} />
      <meshStandardMaterial color="#2f4f3a" />
    </mesh>
  );
};

/** Turn the short way round, so reversing spins rather than snapping. */
const turnTowards = (current: number, target: number, delta: number) => {
  const difference =
    ((((target - current) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) -
    Math.PI;
  return current + difference * Math.min(1, delta * 10);
};

type Gait = "Idle_Loop" | "Walk_Loop" | "Sprint_Loop";

/** Into the push-off, past the clip's own crouch: the controller is already rising. */
const JUMP_START = { from: 0.08, timeScale: 1 };
/** The landing crouch, quickened; skipped when landing on the move. */
const JUMP_LAND = { from: 0, timeScale: 1.5 };

const Runner = () => {
  const { temps, bodyInterface } = useJolt();
  const { character, mixer, play, playOnce, place, getUp } = useMannequin(
    [0, 0, 4],
    "Idle_Loop",
  );
  const model = useCharacterModel(character);
  const [ragdoll] = useRagdoll(model, {
    mode: "hardKeying",
    mixer,
    group: RAGDOLL,
    mask: STATIC | MOVING | CLOTH,
  });
  // After the ragdoll, which animates the bones: the cape is drawn on this
  // frame's pose, not last frame's.
  const [cape] = useState(createCape);
  const [capeTexture] = useState(createCapeTexture);
  const [limp, setLimp] = useState(false);
  const [capeRef, capeApi] = useSoftBody(cape.geometry, {
    skin: {
      mesh: model.mesh,
      bone: CAPE_BONE,
      maxDistance: (_, index) => cape.slack[index],
      backStopDistance: (_, index) => cape.clearance[index],
      backStopRadius: 0.2,
    },
    pinned: (_, index) => cape.pinned(index),
    mass: 1.5,
    iterations: 10,
    linearDamping: 1,
    // A little stiffness damps the short ripples air drag excites by the
    // shoulders; free bending flickered at a walk.
    bendCompliance: 0.001,
    vertexRadius: 0.02,
    friction: 0.5,
    layer: CLOTH_LAYER,
    // Limp, the skin can lie under the floor; held to it, the cape fights the
    // floor. It drapes from its pinned edge instead.
    skinConstraints: !limp,
  });

  const [controller] = useCharacter({
    position: [0, 0, 4],
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

  const state = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(0, 1, 0),
    velocity: new Vector3(),
    /** The point the camera follows, eased toward the pelvis. */
    followed: new Vector3(),
    pelvis: new Vector3(),
    moved: new Vector3(),
    anchored: false,
    yaw: 0,
    facing: 0,
    gait: "Idle_Loop" as Gait,
    /** Feet off the ground last frame. */
    airborne: false,
    /** A jump or landing clip is playing; the gait waits for it. */
    oneShot: false,
    /** The direction at takeoff: in the air it is kept, not steered. */
    airDirection: new Vector3(),
    /** Seconds limp, or null on its feet. */
    down: null as number | null,
    /** Limp by R, so it stays down until R again. */
    held: false,
    gettingUp: false,
    /** R was down last frame: the toggle fires on the press, not while held. */
    ragdollKey: false,
    /** Limp on its back, so the cape is under it. */
    faceUp: false,
    lying: {
      pelvis: new Vector3(),
      head: new Vector3(),
      leftShoulder: new Vector3(),
      rightShoulder: new Vector3(),
    },
  });

  const bodyAt = (api: RagdollApi, bone: string, target: Vector3) => {
    const at = bodyInterface.GetPosition(api.bodyOf(bone)!);
    return target.set(at.GetX(), at.GetY(), at.GetZ());
  };

  /**
   * Cloth collides at its vertices only, so a swinging limb slips between
   * them and tangles it: on its feet the cape touches only the torso it hangs
   * against. Limp and face down, it lies over the whole ragdoll. Face up it
   * touches none of it and drapes through: trapped under a body lying on it,
   * it thrashed and never let the body settle.
   */
  const [capeTouches] = useState(() => ({ ragdoll: new Set<number>(), torso: new Set<number>() }));
  useEffect(() => {
    if (!ragdoll) return;
    ragdoll.bones.forEach((bone, index) => {
      const id = ragdoll.bodies[index].GetIndexAndSequenceNumber();
      capeTouches.ragdoll.add(id);
      if (TORSO.test(bone)) capeTouches.torso.add(id);
    });
  }, [ragdoll, capeTouches]);
  useSoftBodyContactListener({
    onSoftBodyContactValidate: (_cape, other) => {
      const id = other.GetID().GetIndexAndSequenceNumber();
      if (!capeTouches.ragdoll.has(id)) return true;
      const now = state.current;
      if (now.down === null) return capeTouches.torso.has(id);
      return !now.faceUp;
    },
  });

  // The camera follows the character, and the canvas outlives the scene.
  useEffect(() => {
    const start = camera.position.clone();
    const target = orbit?.target.clone();

    return () => {
      camera.position.copy(start);
      if (target) orbit?.target.copy(target);
    };
  }, [camera, orbit]);

  const [pelvisBone] = useState(() => character.getObjectByName("pelvis")!);

  /**
   * One point, whatever the character is doing: the pelvis as drawn. The
   * controller's feet, the ragdoll's root body and the spot a get-up starts
   * from all sit in different places, and switching between them snapped the
   * camera; the bodies themselves move only on physics steps, so following
   * one jittered between them. The drawn pelvis is interpolated and continuous
   * through every hand-over.
   */
  const follow = (delta: number) => {
    const now = state.current;
    pelvisBone.getWorldPosition(now.pelvis);

    if (!now.anchored) {
      now.followed.copy(now.pelvis);
      now.anchored = true;
      return;
    }

    const across = 1 - Math.exp(-FOLLOW_ACROSS * delta);
    const up = 1 - Math.exp(-FOLLOW_UP * delta);
    now.moved.set(
      (now.pelvis.x - now.followed.x) * across,
      (now.pelvis.y - now.followed.y) * up,
      (now.pelvis.z - now.followed.z) * across,
    );
    now.followed.add(now.moved);
    camera.position.add(now.moved);
    orbit?.target.add(now.moved);
  };

  const goLimp = (api: RagdollApi, held: boolean) => {
    const now = state.current;
    api.setMode("passive");
    api.setLinearVelocity(now.velocity);
    setLimp(true);
    now.down = 0;
    now.held = held;
    now.gettingUp = false;
    now.airborne = false;
    now.oneShot = false;
  };

  const standUp = (api: RagdollApi) => {
    const now = state.current;
    setLimp(false);
    const plan = getUp(api, "Idle_Loop", function stood() {
      state.current.gettingUp = false;
    });

    controller!.character.SetPosition(
      temps.rvec3([plan.position.x, plan.position.y + 0.05, plan.position.z]),
    );
    controller!.character.SetLinearVelocity(temps.vec3([0, 0, 0]));
    now.velocity.set(0, 0, 0);
    now.yaw = plan.yaw;
    now.facing = plan.yaw;
    now.gait = "Idle_Loop";
    now.airborne = false;
    now.oneShot = false;
    now.down = null;
    now.held = false;
    now.gettingUp = true;
  };

  useFrame(function run(_, delta) {
    if (!controller || !ragdoll) return;
    const now = state.current;

    follow(delta);

    const keys = getKeys() as Record<string, boolean>;
    const pressed = keys.ragdoll && !now.ragdollKey;
    now.ragdollKey = keys.ragdoll;

    if (now.down !== null) {
      now.down += delta;
      now.faceUp = chestFacesUp({
        pelvis: bodyAt(ragdoll, "pelvis", now.lying.pelvis),
        head: bodyAt(ragdoll, "Head", now.lying.head),
        leftShoulder: bodyAt(ragdoll, "upperarm_l", now.lying.leftShoulder),
        rightShoulder: bodyAt(ragdoll, "upperarm_r", now.lying.rightShoulder),
      });

      const settled =
        now.down >= SETTLE_SECONDS && (!ragdoll.isActive() || now.down >= MAX_DOWN);
      if (pressed || (!now.held && settled)) standUp(ragdoll);
      return;
    }

    if (pressed) {
      goLimp(ragdoll, true);
      return;
    }

    const { direction, forward, right, up } = now;
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, up).normalize();

    // No control with the feet off the ground: the takeoff direction is held,
    // not zeroed — the controller eases toward its input in the air, and
    // zero would brake the jump in mid-flight.
    const planted = controller.character.IsSupported();
    direction.set(0, 0, 0);
    if (!planted) {
      direction.copy(now.airDirection);
    } else if (!now.gettingUp) {
      if (keys.forward) direction.add(forward);
      if (keys.backward) direction.sub(forward);
      if (keys.right) direction.add(right);
      if (keys.left) direction.sub(right);
      if (direction.lengthSq() > 0) {
        direction.normalize().multiplyScalar(keys.sprint ? 1 : WALK);
      }
      now.airDirection.copy(direction);
    }
    const moving = direction.lengthSq() > 0;
    const jumping = planted && !now.gettingUp && keys.jump;

    const step = Math.min(delta, 1 / 30);
    controller.update(direction, jumping, false, step);

    const at = controller.character.GetPosition();
    const velocity = controller.character.GetLinearVelocity();
    now.velocity.set(velocity.GetX(), velocity.GetY(), velocity.GetZ());
    const supported = controller.character.IsSupported();

    if (!supported && now.velocity.y < -FALL_SPEED) {
      goLimp(ragdoll, false);
      return;
    }

    // Placed from the controller even while the get-up plays, facing where
    // `getUp` turned it: the controller settles onto the ground in the first
    // frames, and a root left where `getUp` put it would jump to it when
    // control comes back.
    if (planted && moving && !now.gettingUp) {
      now.yaw = Math.atan2(direction.x, direction.z);
    }
    now.facing = turnTowards(now.facing, now.yaw, delta);
    place(at.GetX(), at.GetY(), at.GetZ(), now.facing);

    if (now.gettingUp) return;

    const gaitNow = (): Gait =>
      !moving ? "Idle_Loop" : keys.sprint ? "Sprint_Loop" : "Walk_Loop";

    const settle = () => {
      now.oneShot = false;
      now.gait = gaitNow();
      play(now.gait, 0.2);
    };

    if (!supported && !now.airborne) {
      now.airborne = true;
      now.oneShot = true;
      if (jumping) {
        playOnce("Jump_Start", JUMP_START, function tucked() {
          play("Jump_Loop", 0.2);
        });
      } else {
        play("Jump_Loop", 0.2);
      }
      return;
    }

    if (supported && now.airborne) {
      now.airborne = false;
      if (moving) settle();
      else playOnce("Jump_Land", JUMP_LAND, settle, 0.08);
      return;
    }

    if (!supported) return;

    const gait = gaitNow();
    // A landing gives way to moving off, and otherwise plays out.
    if (now.oneShot && !moving) return;
    if (gait !== now.gait || now.oneShot) {
      now.oneShot = false;
      now.gait = gait;
      play(gait, 0.25);
    }
  }, RUNNER_PRIORITY);

  return (
    <>
      <primitive object={character} />
      <mesh ref={capeRef} geometry={capeApi?.geometry} castShadow receiveShadow>
        <meshStandardMaterial map={capeTexture} side={DoubleSide} roughness={0.8} />
      </mesh>
    </>
  );
};

export const RagdollCharacterScene = () => (
  <KeyboardControls map={controls}>
    <Arena />
    <Runner />
  </KeyboardControls>
);
