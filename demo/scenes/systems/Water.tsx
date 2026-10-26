import { useRef, useState, type ReactElement, type RefObject } from "react";
import { Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { KeyboardControls, useKeyboardControls } from "@react-three/drei";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCylinder } from "@/Jolt/useCylinder";
import { useCharacter } from "@/Jolt/useCharacter";
import type { CompoundChild } from "@/Jolt/useCompound";
import { useJolt } from "@/Jolt/useJolt";
import { useSwimming } from "@/Jolt/useSwimming";
import { WaterVolume } from "@/Jolt/WaterVolume";
import type { QuatTuple, Vec3Tuple, WaterEvent } from "@/Jolt/types";
import { Hud, Tag } from "../../shared/Stage";
import { useMannequin } from "../../shared/mannequin";
import { WaterSurface, type WaterSurfaceHandle } from "../../shared/WaterSurface";
import { WAVE_CREST, waveHeight } from "../../shared/waves";
import { BeachBall } from "../../shared/BeachBall";
import { turnTowards } from "../../shared/helpers";

const controls = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "jump", keys: ["Space"] },
  { name: "dive", keys: ["KeyC"] },
  { name: "sprint", keys: ["ShiftLeft", "ShiftRight"] },
];

const POOL = { width: 16, length: 12, floor: -4 };
const SURFACE = -0.6;
/** Up to the crests, so the volume finds a body riding one. */
const WATER_TOP = SURFACE + WAVE_CREST + 0.05;
const WATER_HEIGHT = WATER_TOP - POOL.floor;
const WATER_Y = (WATER_TOP + POOL.floor) / 2;

const CURRENT = { x: -6, width: 4, speed: 2 };

const RAMP_RISE = -POOL.floor;
const RAMP_RUN = POOL.width / 2;
const RAMP_ANGLE = Math.atan2(RAMP_RISE, RAMP_RUN);
const RAMP_LENGTH = Math.hypot(RAMP_RISE, RAMP_RUN);
const RAMP_THICKNESS = 0.4;
const RAMP_Z = 4;


const DROP_EVERY = 1.4;
const DROP_CAP = 24;

const Slab = ({
  position,
  size,
  rotation,
  color = "#2a2a2a",
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  rotation?: QuatTuple;
  color?: string;
}) => {
  const [ref] = useBox({ position, size, rotation, motionType: "static" });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/** Ground 5 deep with a pit cut out of it, and a ramp climbing out at +x. */
const Basin = () => {
  const halfWidth = POOL.width / 2;
  const halfLength = POOL.length / 2;
  const side = (40 - POOL.width) / 2;
  const end = (40 - POOL.length) / 2;

  return (
    <>
      <Slab position={[0, -2.5, -halfLength - end / 2]} size={[40, 5, end]} />
      <Slab position={[0, -2.5, halfLength + end / 2]} size={[40, 5, end]} />
      <Slab
        position={[-halfWidth - side / 2, -2.5, 0]}
        size={[side, 5, POOL.length]}
      />
      <Slab
        position={[halfWidth + side / 2, -2.5, 0]}
        size={[side, 5, POOL.length]}
      />
      <Slab
        position={[0, POOL.floor - 0.5, 0]}
        size={[POOL.width, 1, POOL.length]}
        color="#1f3a4a"
      />
      <Slab
        position={[
          RAMP_RUN / 2 + (RAMP_THICKNESS / 2) * Math.sin(RAMP_ANGLE),
          POOL.floor / 2 - (RAMP_THICKNESS / 2) * Math.cos(RAMP_ANGLE),
          RAMP_Z,
        ]}
        size={[RAMP_LENGTH, RAMP_THICKNESS, 4]}
        rotation={[0, 0, Math.sin(RAMP_ANGLE / 2), Math.cos(RAMP_ANGLE / 2)]}
        color="#3a3a3a"
      />
    </>
  );
};

type Kind = "crate" | "stone" | "buoy" | "log";
const KINDS: Kind[] = ["crate", "crate", "stone", "buoy", "log"];

interface Drop {
  id: number;
  kind: Kind;
  position: Vec3Tuple;
  rotation: QuatTuple;
}

const Crate = ({ position, rotation }: Drop) => {
  const [ref] = useBox({
    position,
    rotation,
    size: [0.8, 0.8, 0.8],
    motionType: "dynamic",
    mass: 8,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color="#b7791f" />
    </mesh>
  );
};

/** `floats: false`: drag and buoyancy both off, so it drops like a stone. */
const Stone = ({ position, rotation }: Drop) => {
  const [ref] = useBox({
    position,
    rotation,
    size: [0.6, 0.6, 0.6],
    motionType: "dynamic",
    mass: 20,
    floats: false,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#7f8c8d" />
    </mesh>
  );
};

/** `floats: 2` doubles the water's buoyancy for this one: it rides high. */
const Buoy = ({ position }: Drop) => {
  const [ref] = useSphere({
    position,
    radius: 0.35,
    motionType: "dynamic",
    mass: 2,
    floats: 2,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 20, 16]} />
      <meshStandardMaterial color="#e74c3c" roughness={0.35} />
    </mesh>
  );
};

const Log = ({ position, rotation }: Drop) => {
  const [ref] = useCylinder({
    position,
    rotation,
    radius: 0.25,
    height: 1.6,
    motionType: "dynamic",
    mass: 12,
  });

  return (
    <mesh ref={ref} castShadow>
      <cylinderGeometry args={[0.25, 0.25, 1.6, 16]} />
      <meshStandardMaterial color="#8e5b3a" />
    </mesh>
  );
};

const bodies: Record<Kind, (drop: Drop) => ReactElement> = {
  crate: Crate,
  stone: Stone,
  buoy: Buoy,
  log: Log,
};

const randomRotation = (): QuatTuple => {
  const axis = new Vector3(Math.random(), Math.random(), Math.random())
    .subScalar(0.5)
    .normalize();
  const half = Math.random() * Math.PI;
  const sine = Math.sin(half);
  return [axis.x * sine, axis.y * sine, axis.z * sine, Math.cos(half)];
};

const useDrops = () => {
  const [drops, setDrops] = useState<Drop[]>([]);
  const since = useRef(DROP_EVERY);
  const nextID = useRef(0);

  useFrame(function drop(_, delta) {
    since.current += delta;
    if (since.current < DROP_EVERY) return;
    since.current = 0;
    nextID.current += 1;

    const next: Drop = {
      id: nextID.current,
      kind: KINDS[Math.floor(Math.random() * KINDS.length)],
      position: [(Math.random() - 0.5) * 12, 4, -5 + Math.random() * 6],
      rotation: randomRotation(),
    };
    setDrops((current) => [
      ...current.slice(Math.max(0, current.length - (DROP_CAP - 1))),
      next,
    ]);
  });

  return drops;
};

type Clip =
  | "Idle_Loop"
  | "Walk_Loop"
  | "Sprint_Loop"
  | "Jump_Loop"
  | "Swim_Idle_Loop"
  | "Swim_Fwd_Loop";

const MOVE_SPEED = 6.5;
const WALK = 0.4;
/** Off the ground this long before the fall pose, so a step down is not a jump. */
const AIRBORNE_AFTER = 0.2;
/** Feet this far below the surface swim; the swim clips put the waterline at the root. */
const SWIM_DEPTH = 1.1;

const RADIUS = 0.35;
const HEIGHT = 1.1;
const STANDING_CENTRE = HEIGHT / 2 + RADIUS;
/** Back along the body, where `Swim_Fwd_Loop` puts its middle: head 0.54 ahead, feet 0.9 behind. */
const SWIM_POSITION_BACK = 0.18;

/**
 * The swimming position, taken swimming forward: a capsule along the
 * character's +z, resting on the feet so it still stands on the ramp on the
 * way out.
 */
const SWIM_POSITION: CompoundChild[] = [
  {
    type: "capsule",
    position: [0, RADIUS, -SWIM_POSITION_BACK],
    rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    height: HEIGHT,
    radius: RADIUS,
  },
];

/** The swimming position floats the feet shallower by the drop in centre, so the body stays put. */
const SWIM_POSITION_DEPTH = SWIM_DEPTH - (STANDING_CENTRE - RADIUS);
/** How quickly the model eases between its walking and swimming heights, per second. */
const LIFT_RATE = 5;
/** Seconds between the rings a moving swimmer or wader pushes out. */
const WAKE_EVERY = 0.25;

/**
 * The mannequin on a `useCharacter`, with `useSwimming` deciding between the
 * walking and swimming clips. The swim clips are authored with the root at the
 * waterline, so while swimming the model sits as far above the feet as they
 * float under the surface: at the surface when floating, and carried down with
 * the controller on a dive.
 *
 * Swimming forward (`swim.moving`) swaps in the `SWIM_POSITION` capsule with
 * `setShape`, turned with the character to face the way it swims. Off the
 * ground the feet move up or down by the change in the body's centre as it
 * does, and `setFloatDepth` floats them there, so the body does not drop or
 * bob as it turns.
 */
const Player = ({
  surface,
}: {
  surface: RefObject<WaterSurfaceHandle | null>;
}) => {
  const { character: model, mixer, play, place } = useMannequin(
    [0, 0, 9],
    "Idle_Loop",
    [0, Math.PI, 0],
  );
  const [api] = useCharacter({
    position: [0, 0.2, 9],
    innerBody: true,
    options: {
      height: { standing: HEIGHT, crouching: HEIGHT },
      radius: { standing: RADIUS, crouching: RADIUS },
      moveSpeed: MOVE_SPEED,
      jumpSpeed: 6,
    },
  });
  const swim = useSwimming(api, { depth: SWIM_DEPTH, speed: 0.5 });
  const { temps } = useJolt();

  const [, getKeys] = useKeyboardControls();
  const camera = useThree((state) => state.camera);
  const [readout, setReadout] = useState("dry");

  const scratch = useRef({
    direction: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    up: new Vector3(0, 1, 0),
    yaw: Math.PI,
    facing: Math.PI,
    clip: "Idle_Loop" as Clip,
    airborne: 0,
    /** 0 walking, 1 swimming, eased between. */
    swimmed: 0,
    wake: 0,
    wet: false,
    inSwimPosition: false,
    sampled: 0,
  });

  /** Swaps the shape, keeping the body's centre where it is while afloat. */
  const takeSwimPosition = (take: boolean) => {
    if (!api) return;
    const position = api.character.GetPosition();
    const rise = api.character.IsSupported()
      ? 0
      : (take ? 1 : -1) * (STANDING_CENTRE - RADIUS);
    const at = [position.GetX(), position.GetY(), position.GetZ()] as const;

    api.character.SetPosition(temps.rvec3([at[0], at[1] + rise, at[2]]));
    if (!api.setShape(take ? SWIM_POSITION : null)) {
      api.character.SetPosition(temps.rvec3([at[0], at[1], at[2]]));
      return;
    }

    scratch.current.inSwimPosition = take;
    swim.setFloatDepth(take ? SWIM_POSITION_DEPTH : null);
  };

  useFrame(function drive(_, delta) {
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
    const moving = direction.lengthSq() > 0;
    if (moving) {
      state.yaw = Math.atan2(direction.x, direction.z);
      direction.normalize().multiplyScalar(keys.sprint ? 1 : WALK);
    }

    const step = Math.min(delta, 1 / 30);
    swim.setVertical(keys.jump ? 1 : keys.dive ? -1 : 0);
    api.character.SetRotation(
      temps.quat([0, Math.sin(state.facing / 2), 0, Math.cos(state.facing / 2)]),
    );
    api.update(direction, keys.jump, false, step, {
      overrideUpdate: swim.overrideUpdate,
    });
    mixer.update(delta);

    const swimPosition = swim.swimming && swim.moving;
    if (swimPosition !== state.inSwimPosition) takeSwimPosition(swimPosition);

    state.airborne = api.character.IsSupported() ? 0 : state.airborne + delta;

    const clip: Clip = swim.swimming
      ? state.inSwimPosition
        ? "Swim_Fwd_Loop"
        : "Swim_Idle_Loop"
      : state.airborne > AIRBORNE_AFTER
        ? "Jump_Loop"
        : moving
          ? keys.sprint
            ? "Sprint_Loop"
            : "Walk_Loop"
          : "Idle_Loop";

    if (clip !== state.clip) {
      state.clip = clip;
      play(clip, 0.3);
    }

    // Eased in and out of the water only: the swimming position moves the feet and the
    // float depth by the same amount the other way, so their sum is smooth.
    const swimmed = swim.swimming ? 1 : 0;
    state.swimmed += (swimmed - state.swimmed) * Math.min(1, delta * LIFT_RATE);
    const lift =
      state.swimmed *
      (state.inSwimPosition ? SWIM_POSITION_DEPTH : SWIM_DEPTH);
    state.facing = turnTowards(state.facing, state.yaw, delta);

    const position = api.character.GetPosition();
    place(
      position.GetX(),
      position.GetY() + lift,
      position.GetZ(),
      state.facing,
    );

    // Its inner body is moved by teleport, so the volume's own `onEnter`
    // reports it at rest: the splash comes from the controller's velocity.
    const velocity = api.character.GetLinearVelocity();
    const wet = swim.depth > 0;
    if (wet && !state.wet && velocity.GetY() < -1) {
      surface.current?.splash(
        position.GetX(),
        position.GetZ(),
        0.5 + Math.min(1.5, -velocity.GetY() / 5),
      );
    }
    state.wet = wet;

    // The body pushes rings out wherever it cuts the surface, sized by speed.
    const speed = Math.hypot(velocity.GetX(), velocity.GetZ());
    const cutsSurface = wet && swim.depth < 1.8;
    state.wake += delta;
    if (cutsSurface && speed > 0.3 && state.wake > WAKE_EVERY) {
      state.wake = 0;
      surface.current?.splash(
        position.GetX(),
        position.GetZ(),
        Math.min(0.6, 0.15 + speed * 0.12),
      );
    }

    state.sampled += delta;
    if (state.sampled < 0.15) return;
    state.sampled = 0;
    const where = swim.swimming ? "swimming" : swim.depth > 0 ? "wading" : "dry";
    setReadout(
      swim.depth > 0 ? `${where} · feet ${swim.depth.toFixed(1)} m down` : where,
    );
  });

  return (
    <>
      <primitive object={model} />
      <Hud position={[0, 5, 8]}>
        <b>{readout}</b>
      </Hud>
    </>
  );
};

/** A splash for each body that falls in, sized by how fast it hit the water. */
const useSplash = (surface: RefObject<WaterSurfaceHandle | null>) =>
  function splash(event: WaterEvent) {
    // Drifting from one volume into the next is an enter too, but no splash.
    if (event.velocity.y > -1) return;
    surface.current?.splash(
      event.position.x,
      event.position.z,
      0.5 + Math.min(1.5, -event.velocity.y / 5),
    );
  };


const CURRENT_STRIP = {
  fromX: CURRENT.x - CURRENT.width / 2,
  toX: CURRENT.x + CURRENT.width / 2,
  speed: CURRENT.speed,
};

export const Water = () => {
  const drops = useDrops();
  const surface = useRef<WaterSurfaceHandle>(null);
  const splash = useSplash(surface);

  return (
    <KeyboardControls map={controls}>
      <Basin />

      <WaterVolume
        position={[0, WATER_Y, 0]}
        size={[POOL.width, WATER_HEIGHT, POOL.length]}
        surfaceLevel={SURFACE}
        waves={waveHeight}
        buoyancy={1.4}
        linearDrag={2}
        onEnter={splash}
      />
      <WaterVolume
        position={[CURRENT.x, WATER_Y, 0]}
        size={[CURRENT.width, WATER_HEIGHT, POOL.length]}
        surfaceLevel={SURFACE}
        waves={waveHeight}
        buoyancy={1.4}
        linearDrag={2}
        flow={[0, 0, -CURRENT.speed]}
        priority={1}
        onEnter={splash}
      />
      <WaterSurface
        ref={surface}
        position={[0, SURFACE, 0]}
        size={[POOL.width, POOL.length]}
        current={CURRENT_STRIP}
      />

      {drops.map((drop) => {
        const Body = bodies[drop.kind];
        return <Body key={drop.id} {...drop} />;
      })}

      <BeachBall position={[3, 2, 2]} floats={10} />
      <Player surface={surface} />

      <Tag position={[CURRENT.x, 1, POOL.length / 2 + 1]}>current</Tag>
      <Tag position={[RAMP_RUN / 2, 1, RAMP_Z + 2.5]}>ramp out</Tag>
    </KeyboardControls>
  );
};
