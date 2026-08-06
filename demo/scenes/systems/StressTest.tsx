import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Group, Vector3 } from "three";
import type Jolt from "jolt-physics";
import { Floor, Hud, Wall } from "../../shared/Stage";
import { tilt, useBeam } from "../../shared/helpers";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCapsule } from "@/Jolt/useCapsule";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import { useConvex } from "@/Jolt/useConvex";
import { useCompound } from "@/Jolt/useCompound";
import { useTrimesh } from "@/Jolt/useTrimesh";
import { useCar } from "@/Jolt/useCar";
import { useCharacter } from "@/Jolt/useCharacter";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useContactListener } from "@/Jolt/useContactListener";
import { useConveyor } from "@/Jolt/useConveyor";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import { useAnyHitRaycaster } from "@/Jolt/useAnyHitRaycaster";
import { useAllHitsRaycaster } from "@/Jolt/useAllHitsRaycaster";
import { useJolt } from "@/Jolt/useJolt";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const ARENA = 40;
const SPAWN_SECONDS = 0.05;
const LIVE_BODIES = 1500;
const UPRIGHT: QuatTuple = [0, 0, 0, 1];

/**
 * One number in, a repeatable stream of numbers out. Every spawned body derives
 * all of its own dimensions from its seed, so nothing has to be stored beside it
 * and a re-render of the list never reshuffles a body already simulating.
 */
const random = (seed: number, index: number) => {
  const value = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const between = (seed: number, index: number, low: number, high: number) =>
  low + random(seed, index) * (high - low);

const HUES = [
  "#8e44ad",
  "#16a085",
  "#d35400",
  "#2980b9",
  "#c0392b",
  "#27ae60",
  "#f1c40f",
];

const hue = (seed: number) => HUES[Math.floor(random(seed, 8) * HUES.length)];

interface SpawnProps {
  seed: number;
  onWake: () => void;
  onSleep: () => void;
}

/**
 * Everything the seven shape hooks have in common, per seed. The mesh is given
 * the same transform in JSX: the hook only writes it on the first frame *after*
 * the body exists, and without this every spawn is drawn at the origin until
 * then — which at this spawn rate is a permanent pile of shapes at 0, 0, 0.
 */
const common = ({ seed, onWake, onSleep }: SpawnProps) => ({
  position: [
    between(seed, 1, -13, 13),
    22 + between(seed, 2, 0, 8),
    between(seed, 3, -13, 13),
  ] as Vec3Tuple,
  rotation: tilt(
    [between(seed, 4, -1, 1), between(seed, 5, -1, 1), between(seed, 6, -1, 1)],
    between(seed, 7, 0, Math.PI),
  ),
  motionType: "dynamic" as const,
  material: {
    friction: between(seed, 11, 0.1, 0.9),
    restitution: between(seed, 12, 0, 0.6),
  },
  gravityFactor: between(seed, 13, 0.7, 1.3),
  onWake,
  onSleep,
});

/**
 * Every fifth body swirls for as long as it is alive. Fifty-odd bodies each
 * pushing themselves every frame is what exercises the force path here, rather
 * than leaving the scene a pure collision benchmark.
 */
const useSwirl = (seed: number, api: BodyApi<Jolt.Shape> | undefined) => {
  const elapsed = useRef(random(seed, 9) * 10);
  const swirls = random(seed, 10) < 0.2;

  useFrame((_, delta) => {
    if (!api || !swirls) return;

    elapsed.current += delta;
    api.applyForce([
      Math.cos(elapsed.current) * 45,
      35,
      Math.sin(elapsed.current) * 45,
    ]);
  });
};

const Boxy = memo((props: SpawnProps) => {
  const { seed } = props;
  const size = useMemo<Vec3Tuple>(
    () => [
      between(seed, 20, 0.4, 1.3),
      between(seed, 21, 0.4, 1.3),
      between(seed, 22, 0.4, 1.3),
    ],
    [seed],
  );

  const base = common(props);
  const [ref, api] = useBox({ ...base, size, mass: 3 });
  useSwirl(seed, api);

  return (
    <mesh
      ref={ref}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <boxGeometry args={size} />
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  );
});

const Bally = memo((props: SpawnProps) => {
  const { seed } = props;
  const radius = between(seed, 20, 0.25, 0.7);

  const base = common(props);
  const [ref, api] = useSphere({ ...base, radius, mass: 2 });
  useSwirl(seed, api);

  return (
    <mesh
      ref={ref}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <sphereGeometry args={[radius, 16, 12]} />
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  );
});

const Pill = memo((props: SpawnProps) => {
  const { seed } = props;
  const radius = between(seed, 20, 0.2, 0.45);
  const height = between(seed, 21, 0.4, 1.3);

  const base = common(props);
  const [ref, api] = useCapsule({ ...base, radius, height, mass: 2 });
  useSwirl(seed, api);

  return (
    <mesh
      ref={ref}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <capsuleGeometry args={[radius, height, 6, 12]} />
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  );
});

const Drum = memo((props: SpawnProps) => {
  const { seed } = props;
  const radius = between(seed, 20, 0.25, 0.7);
  const height = between(seed, 21, 0.3, 1.3);

  const base = common(props);
  const [ref, api] = useCylinder({ ...base, radius, height, mass: 3 });
  useSwirl(seed, api);

  return (
    <mesh
      ref={ref}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <cylinderGeometry args={[radius, radius, height, 14]} />
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  );
});

const Cone = memo((props: SpawnProps) => {
  const { seed } = props;
  const base = common(props);
  const [ref, api] = useTaperedCapsule({
    ...base,
    topRadius: between(seed, 20, 0.1, 0.5),
    bottomRadius: between(seed, 21, 0.1, 0.6),
    height: between(seed, 22, 0.5, 1.2),
    mass: 3,
  });
  useSwirl(seed, api);

  return api ? (
    <mesh
      ref={ref}
      geometry={api.geometry}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  ) : null;
});

const Hull = memo((props: SpawnProps) => {
  const { seed } = props;
  const vertices = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => [
        between(seed, 30 + index * 3, -0.7, 0.7),
        between(seed, 31 + index * 3, -0.7, 0.7),
        between(seed, 32 + index * 3, -0.7, 0.7),
      ]),
    [seed],
  );

  const base = common(props);
  const [ref, api] = useConvex({ ...base, vertices, mass: 3 });
  useSwirl(seed, api);

  return api ? (
    <mesh
      ref={ref}
      geometry={api.geometry}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <meshStandardMaterial color={hue(seed)} flatShading />
    </mesh>
  ) : null;
});

const Cluster = memo((props: SpawnProps) => {
  const { seed } = props;
  const shapes = useMemo(
    () =>
      [
        {
          type: "box" as const,
          position: [0, 0, 0] as Vec3Tuple,
          size: [between(seed, 20, 0.5, 1.2), 0.35, 0.35] as Vec3Tuple,
        },
        {
          type: "sphere" as const,
          position: [0, between(seed, 21, 0.4, 0.8), 0] as Vec3Tuple,
          radius: between(seed, 22, 0.2, 0.4),
        },
      ] satisfies Parameters<typeof useCompound>[0]["shapes"],
    [seed],
  );

  const base = common(props);
  const [ref, api] = useCompound({ ...base, shapes, mass: 4 });
  useSwirl(seed, api);

  return api ? (
    <mesh
      ref={ref}
      geometry={api.geometry}
      position={base.position}
      quaternion={base.rotation}
      castShadow
    >
      <meshStandardMaterial color={hue(seed)} />
    </mesh>
  ) : null;
});

const SHAPES = [Boxy, Bally, Pill, Drum, Cone, Hull, Cluster];

/** A hand-built ridged strip, so a static trimesh is in the pile too. */
const ridges = () => {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= 24; i += 1) {
    const x = -12 + i;
    const y = i % 2 === 0 ? 0 : 0.4;
    positions.push(x, y, -4, x, y, 4);
  }

  for (let i = 0; i < 24; i += 1) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
};

const Ridges = () => {
  const geometry = useMemo(() => ridges(), []);
  const [ref] = useTrimesh({ mesh: geometry, position: [0, 0.8, -14] });

  return (
    <mesh ref={ref} geometry={geometry} receiveShadow>
      <meshStandardMaterial color="#3c6e8f" flatShading />
    </mesh>
  );
};

const BELT_SIZE: Vec3Tuple = [5, 0.4, 12];

/**
 * A belt down one side, clear of the kinematic `Sweeper`'s lane. Surface
 * velocity is resolved per contact, so this is the one part of the arena whose
 * cost tracks how much debris has piled onto it rather than the body count.
 */
const ConveyorFloor = () => {
  const [ref, api] = useBox({
    position: [14, 0.2, 2],
    size: BELT_SIZE,
    motionType: "static",
    material: { friction: 1 },
  });

  useConveyor(api, { linear: [0, 0, -6] });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={BELT_SIZE} />
      <meshStandardMaterial color="#16a085" />
    </mesh>
  );
};

const Arena = () => (
  <>
    <Floor size={ARENA} friction={0.7} />
    <Wall position={[0, 2, -ARENA / 2]} size={[ARENA, 4, 1]} />
    <Wall position={[0, 2, ARENA / 2]} size={[ARENA, 4, 1]} />
    <Wall position={[-ARENA / 2, 2, 0]} size={[1, 4, ARENA]} />
    <Wall position={[ARENA / 2, 2, 0]} size={[1, 4, ARENA]} />
    <Ridges />
    <ConveyorFloor />
  </>
);

/** Kinematic, driven with `moveKinematic`, ploughing through the pile. */
const Sweeper = () => {
  const [ref, api] = useBox({
    position: [0, 1, 8],
    size: [10, 2, 1],
    motionType: "kinematic",
    material: { friction: 0.9 },
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    api.moveKinematic([0, 1, Math.sin(elapsed.current * 0.4) * 12], UPRIGHT);
  });

  return (
    <mesh ref={ref} position={[0, 1, 8]} castShadow>
      <boxGeometry args={[10, 2, 1]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Wrecker = () => {
  const [ref, api] = useSphere({
    position: [0, 3, 0],
    radius: 2,
    motionType: "kinematic",
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta * 0.7;
    api.moveKinematic(
      [Math.cos(elapsed.current) * 9, 3, Math.sin(elapsed.current) * 9],
      UPRIGHT,
    );
  });

  return (
    <mesh ref={ref} position={[0, 3, 0]} castShadow>
      <sphereGeometry args={[2, 24, 16]} />
      <meshStandardMaterial color="#7f8c8d" metalness={0.7} roughness={0.3} />
    </mesh>
  );
};

interface Counters {
  sensor: number;
  contacts: number;
  wakes: number;
  sleeps: number;
  hits: number;
}

/** A sensor spanning the middle, counting everything that falls through it. */
const Gate = ({ onEntry }: { onEntry: () => void }) => {
  const [ref, api] = useBox({
    position: [0, 8, 0],
    size: [14, 1, 14],
    motionType: "static",
    sensor: true,
  });

  useBodyContacts(api?.body, { onEnter: onEntry });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[14, 1, 14]} />
      <meshStandardMaterial color="#27ae60" transparent opacity={0.12} />
    </mesh>
  );
};

const GRAB_CYCLE = 6;

/**
 * `grab` → `moveTo` → `setScale` → `release`, on a loop, so the manual-control
 * path is under load along with everything else. The body is dynamic again the
 * moment it is released, and the carry velocity becomes the throw.
 */
const Juggler = () => {
  const [ref, api] = useBox({
    position: [10, 1, -10],
    size: [1.4, 1.4, 1.4],
    motionType: "dynamic",
    mass: 6,
    material: { friction: 0.5 },
  });

  const elapsed = useRef(0);
  const carrying = useRef(false);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    const phase = elapsed.current % GRAB_CYCLE;
    const shouldCarry = phase < GRAB_CYCLE * 0.7;

    if (shouldCarry && !carrying.current) {
      api.grab();
      carrying.current = true;
    }

    if (!shouldCarry && carrying.current) {
      api.release();
      carrying.current = false;
      return;
    }

    if (!carrying.current) return;

    const swing = phase * 2;
    api.moveTo(
      [
        Math.cos(swing) * 11,
        6 + Math.sin(swing * 1.7) * 2.5,
        Math.sin(swing) * 11,
      ],
      UPRIGHT,
    );
    api.setScale([1 + Math.sin(swing) * 0.4, 1, 1]);
  });

  return (
    <mesh ref={ref} position={[10, 1, -10]} castShadow>
      <boxGeometry args={[1.4, 1.4, 1.4]} />
      <meshStandardMaterial color="#f1c40f" emissive="#4a3c00" />
    </mesh>
  );
};

const PROBE_EYE = new Vector3(0, 12, 0);

/** All three raycasters, cast every frame into a moving pile. */
const Probes = ({ onCrossings }: { onCrossings: (count: number) => void }) => {
  const [closest] = useClosestHitRaycaster();
  const [any] = useAnyHitRaycaster();
  const [all] = useAllHitsRaycaster();

  const beam = useBeam("#e74c3c");
  const direction = useRef(new Vector3());
  const end = useRef(new Vector3());
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!closest || !any || !all) return;

    elapsed.current += delta;
    direction.current.set(
      Math.cos(elapsed.current) * 10,
      -14,
      Math.sin(elapsed.current) * 10,
    );

    const hit = closest.cast(PROBE_EYE, direction.current);
    any.cast(PROBE_EYE, direction.current);
    const everything = all.cast(PROBE_EYE, direction.current);

    onCrossings(everything.length);

    beam.set(
      PROBE_EYE,
      hit.hit ? hit.point : end.current.copy(PROBE_EYE).add(direction.current),
    );
  });

  return <primitive object={beam.object} />;
};

const CAR_START: Vec3Tuple = [-15, 2, 15];

// Identity faces +Z, which from the near corner is a wall five metres away.
// Turned around, it has the length of the arena to drive.
const CAR_FACING = tilt([0, 1, 0], Math.PI);

/**
 * Scripted, so the vehicle controller runs without the keyboard. The steering
 * swings rather than holding full lock — a car on full lock only ever spins on
 * the spot, which stresses nothing and looks broken.
 */
const Driver = () => {
  const bodyRef = useRef<Group>(null);
  const wheelRefs = useRef<(Group | null)[]>([]);
  const elapsed = useRef(0);

  const [api] = useCar({
    position: CAR_START,
    rotation: CAR_FACING,
    driveType: "awd",
    vehicleSize: { length: 4, width: 1.8, height: 1 },
    wheelSettings: {
      radius: 0.35,
      width: 0.28,
      offsetForward: 1.4,
      offsetDown: 0.3,
    },
  });

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    const steer = Math.sin(elapsed.current * 0.35);

    const state = api.update({
      forward: true,
      backward: false,
      left: steer < -0.25,
      right: steer > 0.25,
      handbrake: false,
      modifier: false,
    });

    if (bodyRef.current) {
      bodyRef.current.position.copy(state.position);
      bodyRef.current.quaternion.copy(state.rotation);
    }

    state.wheels.forEach((wheel, index) => {
      const group = wheelRefs.current[index];
      if (!group) return;

      group.position.copy(wheel.position);
      group.quaternion.copy(wheel.rotation);
    });
  });

  return (
    <group ref={bodyRef} position={CAR_START} quaternion={CAR_FACING}>
      <mesh castShadow>
        <boxGeometry args={[1.8, 1, 4]} />
        <meshStandardMaterial color="#c0392b" />
      </mesh>
      {[0, 1, 2, 3].map((index) => (
        <group
          key={index}
          ref={(node) => {
            wheelRefs.current[index] = node;
          }}
        >
          {/* No rotation of our own: `useCar` asks Jolt for the wheel transform
              with the model's axle along +Y, which is where a three cylinder
              already has it. Turning the mesh as well rotates it twice. */}
          <mesh castShadow>
            <cylinderGeometry args={[0.35, 0.35, 0.28, 16]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
        </group>
      ))}
    </group>
  );
};

/** A CharacterVirtual walking a circle through the falling shapes. */
const Walker = () => {
  const [api] = useCharacter({
    position: [12, 4, 12],
    options: {
      height: { standing: 1.8, crouching: 0.9 },
      radius: { standing: 0.35, crouching: 0.35 },
      moveSpeed: 5,
      jumpSpeed: 7,
    },
  });

  const elapsed = useRef(0);
  const direction = useRef(new Vector3());

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    direction.current
      .set(Math.cos(elapsed.current * 0.5), 0, Math.sin(elapsed.current * 0.5))
      .normalize();

    // A jump every couple of seconds, so the ground-state path runs too.
    api.update(
      direction.current,
      elapsed.current % 2.5 < delta,
      false,
      Math.min(delta, 1 / 30),
    );
  });

  return null;
};

/**
 * Spawning is driven by the frame clock rather than a `setInterval`, and that is
 * the whole trick to a stress scene that degrades instead of locking up: an
 * interval keeps firing at its own rate no matter how far behind the renderer
 * falls, so the work queue outruns the frame loop and the tab stops painting.
 * Tied to `useFrame`, the spawn rate falls with the frame rate on its own.
 */
const Spawner = ({ onSpawn }: { onSpawn: () => void }) => {
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < SPAWN_SECONDS) return;

    elapsed.current = 0;
    onSpawn();
  });

  return null;
};

const SAMPLE_SECONDS = 0.4;

const Readout = ({ counters }: { counters: { current: Counters } }) => {
  const { physicsSystem, Jolt: jolt } = useJolt();
  const [line, setLine] = useState("warming up");
  const elapsed = useRef(0);
  const frames = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current += 1;

    if (elapsed.current < SAMPLE_SECONDS) return;

    const { sensor, contacts, wakes, sleeps, hits } = counters.current;

    setLine(
      `${Math.round(frames.current / elapsed.current)} fps · ` +
        `${physicsSystem.GetNumBodies()} bodies, ` +
        `${physicsSystem.GetNumActiveBodies(jolt.EBodyType_RigidBody)} awake · ` +
        `sensor ${sensor} · contacts ${contacts} · ` +
        `${wakes} wakes / ${sleeps} sleeps · ray crosses ${hits}`,
    );

    elapsed.current = 0;
    frames.current = 0;
  });

  return <Hud position={[0, 7, 0]}>{line}</Hud>;
};

export const StressTest = () => {
  const [spawned, setSpawned] = useState<number[]>([]);
  const next = useRef(0);

  const counters = useRef<Counters>({
    sensor: 0,
    contacts: 0,
    wakes: 0,
    sleeps: 0,
    hits: 0,
  });

  useContactListener({
    onContactAdded: () => {
      counters.current.contacts += 1;
    },
  });

  // Every counter is bumped through one of these rather than by handing the ref
  // itself down: a child that owns no state should not be mutating the parent's.
  const handlers = useMemo(
    () => ({
      onWake: () => {
        counters.current.wakes += 1;
      },
      onSleep: () => {
        counters.current.sleeps += 1;
      },
      onSensorEntry: () => {
        counters.current.sensor += 1;
      },
      onCrossings: (count: number) => {
        counters.current.hits = count;
      },
    }),
    [],
  );

  const spawn = useCallback(() => {
    next.current += 1;
    const seed = next.current;
    setSpawned((current) => [...current.slice(-(LIVE_BODIES - 1)), seed]);
  }, []);

  return (
    <>
      <Arena />
      <Spawner onSpawn={spawn} />
      <Sweeper />
      <Wrecker />
      <Gate onEntry={handlers.onSensorEntry} />
      <Juggler />
      <Probes onCrossings={handlers.onCrossings} />
      <Driver />
      <Walker />

      {spawned.map((seed) => {
        const Shape = SHAPES[seed % SHAPES.length];
        return (
          <Shape
            key={seed}
            seed={seed}
            onWake={handlers.onWake}
            onSleep={handlers.onSleep}
          />
        );
      })}

      <Readout counters={counters} />
    </>
  );
};
