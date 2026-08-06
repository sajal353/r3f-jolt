import { useEffect, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { beltPlacement } from "../../shared/helpers";
import { useBox } from "@/Jolt/useBox";
import { useCylinder } from "@/Jolt/useCylinder";
import { useConveyor } from "@/Jolt/useConveyor";
import type { QuatTuple, Vec3Tuple } from "@/Jolt/types";

const SPEED = 5;
const DECK = 2.25;
const LIFETIME = 10_000;

const LOOP = 19;
const HIGH = 5;
const LOW = 1.5;
const LOOP_WIDTH = 3;
const LOOP_DECK = 0.4;

const yaw = (radians: number): QuatTuple => {
  const q = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 }, radians);
  return [q.x, q.y, q.z, q.w];
};

const Belt = ({
  position,
  size,
  rotation,
  speed,
  color,
  rails = false,
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  rotation?: QuatTuple;
  speed: number;
  color: string;
  rails?: boolean;
}) => {
  const [ref, api] = useBox({
    position,
    size,
    rotation,
    motionType: "static",
    material: { friction: 1 },
  });

  const conveyor = useConveyor(api, { linear: [0, 0, -speed] });

  useEffect(() => {
    conveyor?.setLinear([0, 0, -speed]);
  }, [conveyor, speed]);

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
      {rails && <Rails position={position} size={size} rotation={rotation} />}
    </>
  );
};

/**
 * One guard rail on the outside of the bend, in the belt's own frame so a
 * pitched or turned belt gets it along its edge rather than along a world axis.
 * A crate rounding a corner is thrown outward, so the inner side needs nothing.
 */
const Rails = ({
  position,
  size,
  rotation,
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  rotation?: QuatTuple;
}) => (
  <Rail
    position={offsetInFrame(position, rotation, [
      -(size[0] / 2 + 0.15),
      0.75,
      0,
    ])}
    rotation={rotation}
    size={[0.3, 1.2, size[2]]}
  />
);

const offsetInFrame = (
  origin: Vec3Tuple,
  rotation: QuatTuple | undefined,
  offset: Vec3Tuple,
): Vec3Tuple => {
  const local = new Vector3(...offset);

  if (rotation) local.applyQuaternion(new Quaternion(...rotation));

  return [origin[0] + local.x, origin[1] + local.y, origin[2] + local.z];
};

const Rail = ({
  position,
  rotation,
  size,
}: {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  size: Vec3Tuple;
}) => {
  const [ref] = useBox({
    position,
    rotation,
    size,
    motionType: "static",
    material: { friction: 0.2 },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#3d3d3d" />
    </mesh>
  );
};

/** One side of the circuit, placed from its two deck endpoints. */
const LoopBelt = ({
  from,
  to,
  speed,
  color,
}: {
  from: Vec3Tuple;
  to: Vec3Tuple;
  speed: number;
  color: string;
}) => {
  const { position, rotation, length } = beltPlacement(from, to);

  return (
    <Belt
      position={position}
      size={[LOOP_WIDTH, LOOP_DECK, length]}
      rotation={rotation}
      speed={speed}
      color={color}
      rails
    />
  );
};

const Bucket = ({ position }: { position: Vec3Tuple }) => {
  const [x, y, z] = position;
  const inner = 4;
  const wall = 0.3;
  const tall = 1.8;
  const offset = inner / 2 + wall / 2;

  return (
    <>
      <Slab
        position={[x, y + 0.15, z]}
        size={[inner + wall * 2, 0.3, inner + wall * 2]}
      />
      <Slab
        position={[x - offset, y + tall / 2, z]}
        size={[wall, tall, inner]}
      />
      <Slab
        position={[x + offset, y + tall / 2, z]}
        size={[wall, tall, inner]}
      />
      <Slab
        position={[x, y + tall / 2, z - offset]}
        size={[inner + wall * 2, tall, wall]}
      />
      <Slab
        position={[x, y + tall / 2, z + offset]}
        size={[inner + wall * 2, tall, wall]}
      />
    </>
  );
};

const Slab = ({ position, size }: { position: Vec3Tuple; size: Vec3Tuple }) => {
  const [ref] = useBox({
    position,
    size,
    motionType: "static",
    material: { friction: 0.6 },
  });

  return (
    <mesh ref={ref} receiveShadow castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#4a4a4a" />
    </mesh>
  );
};

const Turntable = ({ position }: { position: Vec3Tuple }) => {
  const [ref, api] = useCylinder({
    position,
    radius: 3,
    height: 0.5,
    motionType: "static",
    material: { friction: 1 },
  });

  // Kept under the slip threshold: a passenger at radius r needs w²r of
  // centripetal force and friction can only supply about g, so a faster table
  // throws its crates off the rim instead of carrying them round.
  useConveyor(api, { angular: [0, 1.2, 0] });

  return (
    <mesh ref={ref} receiveShadow>
      <cylinderGeometry args={[3, 3, 0.5, 48]} />
      <meshStandardMaterial color="#8e44ad" />
    </mesh>
  );
};

const Crate = ({
  position,
  color = "#e67e22",
}: {
  position: Vec3Tuple;
  color?: string;
}) => {
  const [ref] = useBox({
    position,
    size: [0.8, 0.8, 0.8],
    motionType: "dynamic",
    mass: 2,
    material: { friction: 1 },
    // A seam between two belts is an internal edge, and a crate dragged across
    // one catches its leading corner on it. Jolt's edge removal is the fix; the
    // wider convex radius rounds the corner enough to ride over what is left.
    enhancedInternalEdgeRemoval: true,
    convexRadius: 0.1,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/**
 * `lifetime` retires a crate that many milliseconds after it spawned, for belts
 * that shed onto the floor. `limit` keeps the newest N instead, which is what a
 * closed circuit wants: nothing there is lost, so age is no reason to remove it.
 *
 * `position` is read per crate at spawn, so moving the spawn point leaves the
 * crates already riding untouched.
 */
const Feeder = ({
  position,
  every,
  color,
  lifetime,
  limit,
}: {
  position: Vec3Tuple;
  every: number;
  color?: string;
  lifetime?: number;
  limit?: number;
}) => {
  const [crates, setCrates] = useState<
    { id: number; at: number; position: Vec3Tuple }[]
  >([]);

  const next = useRef(0);
  const spawnAt = useRef(position);

  useEffect(() => {
    spawnAt.current = position;
  });

  useEffect(() => {
    const spawn = setInterval(() => {
      next.current += 1;
      setCrates((current) => {
        const grown = [
          ...current,
          { id: next.current, at: Date.now(), position: spawnAt.current },
        ];
        return limit ? grown.slice(-limit) : grown;
      });
    }, every);

    if (lifetime === undefined) return () => clearInterval(spawn);

    const sweep = setInterval(() => {
      const cutoff = Date.now() - lifetime;
      setCrates((current) => current.filter((crate) => crate.at > cutoff));
    }, 500);

    return () => {
      clearInterval(spawn);
      clearInterval(sweep);
    };
  }, [every, lifetime, limit]);

  return (
    <>
      {crates.map((crate) => (
        <Crate key={crate.id} position={crate.position} color={color} />
      ))}
    </>
  );
};

/**
 * A square corner plate. It turns a crate by carrying it diagonally: in along
 * one edge, out along the next. The velocity is world space, because a diagonal
 * across a square has no relationship to the plate's own axes.
 */
const CornerBelt = ({
  position,
  outX,
  outZ,
  speed,
}: {
  position: Vec3Tuple;
  outX: number;
  outZ: number;
  speed: number;
}) => {
  const [ref, api] = useBox({
    position,
    size: [LOOP_WIDTH, LOOP_DECK, LOOP_WIDTH],
    motionType: "static",
    material: { friction: 1 },
  });

  const diagonal = Math.SQRT1_2;
  const conveyor = useConveyor(api, {
    space: "world",
    linear: [outX * diagonal * speed, 0, outZ * diagonal * speed],
  });

  useEffect(() => {
    conveyor?.setLinear([outX * diagonal * speed, 0, outZ * diagonal * speed]);
  }, [conveyor, outX, outZ, speed, diagonal]);

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[LOOP_WIDTH, LOOP_DECK, LOOP_WIDTH]} />
        <meshStandardMaterial color="#e08b3c" />
      </mesh>
      <CornerRails
        position={position}
        signX={Math.sign(position[0])}
        signZ={Math.sign(position[2])}
      />
    </>
  );
};

/** The two outward faces of a corner plate, where a crate is thrown widest. */
const CornerRails = ({
  position,
  signX,
  signZ,
}: {
  position: Vec3Tuple;
  signX: number;
  signZ: number;
}) => {
  const [x, y, z] = position;
  const out = LOOP_WIDTH / 2 + 0.15;
  const span = LOOP_WIDTH + 0.6;

  return (
    <>
      <Rail position={[x + signX * out, y + 0.75, z]} size={[0.3, 1.2, span]} />
      <Rail position={[x, y + 0.75, z + signZ * out]} size={[span, 1.2, 0.3]} />
    </>
  );
};

/**
 * A closed square circuit: high side, ramp down, low side, ramp up, with a
 * square plate at each corner turning the crates through 90°.
 *
 * Every straight carries the same local velocity and differs only in placement,
 * so reversing is one sign for the whole line.
 */
const Circuit = ({ speed }: { speed: number }) => {
  const end = LOOP - LOOP_WIDTH / 2;

  return (
    <>
      <LoopBelt
        from={[-end, HIGH, -LOOP]}
        to={[end, HIGH, -LOOP]}
        speed={speed}
        color="#c0651a"
      />
      <CornerBelt
        position={[LOOP, HIGH, -LOOP]}
        outX={1}
        outZ={1}
        speed={speed}
      />
      <LoopBelt
        from={[LOOP, HIGH, -end]}
        to={[LOOP, LOW, end]}
        speed={speed}
        color="#d47b2e"
      />
      <CornerBelt
        position={[LOOP, LOW, LOOP]}
        outX={-1}
        outZ={1}
        speed={speed}
      />
      <LoopBelt
        from={[end, LOW, LOOP]}
        to={[-end, LOW, LOOP]}
        speed={speed}
        color="#c0651a"
      />
      <CornerBelt
        position={[-LOOP, LOW, LOOP]}
        outX={-1}
        outZ={-1}
        speed={speed}
      />
      <LoopBelt
        from={[-LOOP, LOW, end]}
        to={[-LOOP, HIGH, -end]}
        speed={speed}
        color="#d47b2e"
      />
      <CornerBelt
        position={[-LOOP, HIGH, -LOOP]}
        outX={1}
        outZ={-1}
        speed={speed}
      />
    </>
  );
};

export const Conveyor = () => {
  const [reversed, setReversed] = useState(false);
  const speed = reversed ? -SPEED : SPEED;

  return (
    <>
      <Floor size={70} />

      <Circuit speed={speed} />
      <Feeder
        position={[0, HIGH + 1.4, -LOOP]}
        every={700}
        limit={100}
        color="#f39c12"
      />

      <Belt
        position={[0, DECK, 0]}
        size={[3, 0.5, 22]}
        speed={speed}
        color="#16a085"
      />
      <Bucket position={[0, 0, 13.5]} />
      <Bucket position={[0, 0, -13.5]} />

      <Belt
        position={[-7.5, DECK + 0.5, 0]}
        size={[3, 0.5, 12]}
        rotation={yaw(-Math.PI / 2)}
        speed={SPEED}
        color="#2980b9"
      />

      <Feeder
        position={reversed ? [0, 3.6, -9] : [0, 3.6, 9]}
        every={950}
        lifetime={LIFETIME}
      />
      <Feeder
        position={[-12.5, 5, 0]}
        every={1400}
        lifetime={LIFETIME}
        color="#3498db"
      />

      <Turntable position={[12, 2.3, 0]} />
      <Feeder
        position={[13.6, 4.2, 0]}
        every={1600}
        lifetime={LIFETIME}
        color="#f1c40f"
      />

      <Tag position={[0, 3.4, -11.5]}>green — reversible</Tag>
      <Tag position={[-13, 3.4, 0]}>
        blue — turned 90°, space: &quot;local&quot;
      </Tag>
      <Tag position={[12, 5.4, 0]}>turntable — angular only</Tag>
      <Tag position={[0, HIGH + 1.6, -LOOP]}>circuit — high side</Tag>
      <Tag position={[0, LOW + 1.6, LOOP]}>circuit — low side</Tag>

      <Controls position={[4.5, 3.4, 0]}>
        <button aria-pressed={!reversed} onClick={() => setReversed(false)}>
          forward
        </button>
        <button aria-pressed={reversed} onClick={() => setReversed(true)}>
          reverse
        </button>
      </Controls>

      <Hud position={[0, 9, 0]}>
        circuit + green {reversed ? "←" : "→"} {SPEED} m/s · blue feeds the
        middle either way
      </Hud>
    </>
  );
};
