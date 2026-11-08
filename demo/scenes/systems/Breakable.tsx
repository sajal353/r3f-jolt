import type Jolt from "jolt-physics";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BatchedMesh,
  BoxGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
  type Object3D,
} from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { ConvexObjectBreaker } from "three/examples/jsm/misc/ConvexObjectBreaker.js";
import { Controls, Floor, Hud, Wall } from "../../shared/Stage";
import { finishShape, useBody } from "@/Jolt/internal/useBody";
import { useMutableCompound } from "@/Jolt/useMutableCompound";
import { useSphere } from "@/Jolt/useSphere";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import { useGroupFilterTable } from "@/Jolt/useGroupFilterTable";
import { useJolt } from "@/Jolt/useJolt";
import type { CompoundChild } from "@/Jolt/useCompound";
import type { ContactInfo, QuatTuple, Vec3Tuple } from "@/Jolt/types";

/** A 215 x 65 x 102.5 mm brick at x5.6. The proportions are what read as a wall. */
const BRICK: Vec3Tuple = [1.2, 0.36, 0.57];
const COLUMNS = 8;
const ROWS = 13;

/**
 * How much velocity the estimated impulse would give this piece, in m/s.
 * Mass-relative on purpose: `impulse` is momentum, so one collision reads 3000
 * against a 246 kg brick and 119 against a 40 kg chunk off it, and no absolute
 * number breaks both. Measured — settling peaks at 0.23, a cannonball gives
 * what it hits 4 to 25.
 */
const BREAK_DELTA_V = 0.8;

/** Cells under this are dust, and not worth a draw. */
const MIN_CELL_VOLUME = 1e-5;
const MIN_CELL_THICKNESS = 0.005;

/**
 * A collapsing wall wants to break a dozen bricks in one contact flush. Each one
 * past this stays armed and goes on a later frame.
 */
const MAX_BREAKS_PER_FRAME = 6;

/**
 * A brick is cut before the first render, and every chunk is a child of its
 * compound, so the hull a chunk will fly with already exists when it comes off.
 * Four chunks: one leaning seam makes two slices, and one random cut halves each.
 */
const SLICES = 2;
const CELLS_PER_SLICE = 2;
/** How far the seam leans across the thickness of the brick. */
const SEAM_LEAN = 0.18;
const SEAM_JITTER = 0.25;
const CUT_ATTEMPTS = 8;

/**
 * Bricks share a pool of cuts, made once. Cutting all 110 stalls the first render
 * for over a second, and nobody spots a repeat in a wall.
 */
const CUTS_PER_LENGTH = 10;

/**
 * A hit frees the chunks this close to it per m/s of `BREAK_DELTA_V`'s reading,
 * and always the nearest: a knock chips a brick, a cannonball shatters it.
 */
const BLAST_RADIUS_PER_DELTA_V = 0.15;
const BLAST_KICK = 1.5;

const GRAVITY = 9.81;
const BOUNCE = 0.25;
const SCRAPE = 0.5;
/** Below this falling speed a landed chunk stays where it is. */
const REST_SPEED = 0.6;

const SHOT_RADIUS = 0.35;
const SHOT_MASS = 150;
const SHOT_SPEED = 30;
const SHOT_CAP = 10;

/** A pointer that moved further than this between down and up was an orbit. */
const CLICK_SLOP = 6;

/**
 * Shared, because the JSX-declared kind would be one material per mesh. The
 * variation earns its place twice over: with no mortar joint between them, the
 * shade is the only thing that keeps the bond legible.
 */
const BRICK_MATERIALS = [
  "#9c5238",
  "#8a4630",
  "#a86040",
  "#8f4f3a",
  "#b06a45",
].map((color) => new MeshStandardMaterial({ color, roughness: 0.9 }));

/** White, because each chunk is tinted with the colour of its brick. */
const CHUNK_MATERIAL = new MeshStandardMaterial({ roughness: 0.95 });

const WHOLE_BRICK = new BoxGeometry(...BRICK);
const HALF_BRICK = new BoxGeometry(BRICK[0] / 2, BRICK[1], BRICK[2]);

const shadeFor = (row: number, column: number) =>
  BRICK_MATERIALS[(row * 3 + column * 2) % BRICK_MATERIALS.length];

interface Cell {
  geometry: BufferGeometry;
  /** Its geometry in the wall's `BatchedMesh`. */
  batchId: number;
  thinnest: number;
  /** Where it sits in the brick. */
  home: Vec3Tuple;
}

interface Brick {
  id: number;
  /** In the order of the compound's children. */
  cells: Cell[];
  shapes: CompoundChild[];
  /** What a brick nothing has come off yet draws: one box, no seams. */
  solid: BufferGeometry;
  material: MeshStandardMaterial;
  position: Vec3Tuple;
}

interface Shot {
  id: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

const readGeometry = (geometry: BufferGeometry) => {
  geometry.computeBoundingBox();
  const { x, y, z } = geometry.boundingBox!.getSize(new Vector3());

  return { volume: x * y * z, thinnest: Math.min(x, y, z) };
};

/** Without the repeats a non-indexed geometry has, which a hull only spends time on. */
const verticesOf = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  const unique = new Map<string, number[]>();

  for (let index = 0; index < position.count; index += 1) {
    const point = [
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    ];
    unique.set(point.join(), point);
  }

  return [...unique.values()];
};

const breaker = new ConvexObjectBreaker();
const STILL = new Vector3();

const cutSliceOnce = (geometry: BufferGeometry, width: number, depth: number) => {
  const source = new Mesh(geometry, CHUNK_MATERIAL);
  breaker.prepareBreakableObject(source, 1, STILL, STILL, true);

  const impact = new Vector3(
    (Math.random() - 0.5) * width * 0.6,
    (Math.random() - 0.5) * BRICK[1] * 0.6,
    depth / 2,
  );

  // A cut that grazes a face leaves more than four points with no volume, and
  // `ConvexGeometry` throws building a hull out of them.
  let debris: Object3D[];

  try {
    debris = breaker.subdivideByImpact(
      source,
      impact,
      new Vector3(0, 0, -1),
      0,
      0,
    );
  } catch {
    return [];
  }

  const cells: { geometry: BufferGeometry; at: Vector3; thinnest: number }[] = [];

  for (const object of debris) {
    const { geometry: cut, position } = object as Mesh;
    const { volume, thinnest } = readGeometry(cut);

    if (volume < MIN_CELL_VOLUME || thinnest < MIN_CELL_THICKNESS) {
      cut.dispose();
      continue;
    }

    cells.push({ geometry: cut, at: position.clone(), thinnest });
  }

  return cells;
};

const cutSlice = (geometry: BufferGeometry, width: number, depth: number) => {
  let best: ReturnType<typeof cutSliceOnce> = [];

  for (let attempt = 0; attempt < CUT_ATTEMPTS; attempt += 1) {
    const cells = cutSliceOnce(geometry, width, depth);
    const [kept, dropped] =
      cells.length > best.length ? [cells, best] : [best, cells];

    for (const { geometry: unused } of dropped) unused.dispose();
    best = kept;

    if (best.length >= CELLS_PER_SLICE) break;
  }

  return best;
};

const cutBrick = ([length, height, depth]: Vec3Tuple) => {
  const pitch = length / SLICES;

  const seams = Array.from({ length: SLICES + 1 }, (_, index) => {
    const x = -length / 2 + index * pitch;
    if (index === 0 || index === SLICES) return { front: x, back: x };

    const middle = x + (Math.random() - 0.5) * pitch * SEAM_JITTER;
    const lean = (Math.random() - 0.5) * SEAM_LEAN;
    return { front: middle + lean, back: middle - lean };
  });

  const cells: Cell[] = [];

  for (let index = 0; index < SLICES; index += 1) {
    const [left, right] = [seams[index], seams[index + 1]];
    const middle = (left.front + right.front + left.back + right.back) / 4;

    const corners = [left, right].flatMap((seam) =>
      [-1, 1].flatMap((up) => [
        new Vector3(seam.front - middle, (up * height) / 2, depth / 2),
        new Vector3(seam.back - middle, (up * height) / 2, -depth / 2),
      ]),
    );

    const geometry = new ConvexGeometry(corners);
    const cut = cutSlice(geometry, right.front - left.front, depth);
    geometry.dispose();

    for (const { geometry: cell, at, thinnest } of cut) {
      cells.push({
        geometry: cell,
        batchId: -1,
        thinnest,
        home: [middle + at.x, at.y, at.z],
      });
    }
  }

  const shapes = cells.map(
    ({ geometry, home }): CompoundChild => ({
      type: "convex",
      position: home,
      vertices: verticesOf(geometry),
    }),
  );

  return { cells, shapes };
};

type Pool = ReturnType<typeof cutBrick>[];

const cutPool = (length: number) =>
  Array.from({ length: CUTS_PER_LENGTH }, () =>
    cutBrick([length, BRICK[1], BRICK[2]]),
  );

let pools: { whole: Pool; half: Pool } | null = null;

const takeCut = (length: number) => {
  pools ??= { whole: cutPool(BRICK[0]), half: cutPool(BRICK[0] / 2) };
  const pool = length === BRICK[0] ? pools.whole : pools.half;
  return pool[Math.floor(Math.random() * pool.length)];
};

/**
 * A running bond — alternate courses offset by half a brick and closed at both
 * ends by a half one, so no vertical joint runs through the wall. Nothing bonds
 * them: it is a dry stack standing on friction and its own weight. Courses are
 * laid touching rather than gapped, which is what took the settling impulse
 * from 217 down to 50. 7 x 8 + 6 x 9 = 110 bricks.
 */
const buildWall = (startID: number): Brick[] => {
  const bricks: Brick[] = [];
  const [width, height] = BRICK;
  const span = COLUMNS * width;

  const lay = (row: number, column: number, left: number, length: number) => {
    const { cells, shapes } = takeCut(length);

    bricks.push({
      id: startID + bricks.length,
      cells,
      shapes,
      solid: length === width ? WHOLE_BRICK : HALF_BRICK,
      material: shadeFor(row, column),
      position: [left + length / 2 - span / 2, height / 2 + row * height, 0],
    });
  };

  for (let row = 0; row < ROWS; row += 1) {
    if (row % 2 === 0) {
      for (let column = 0; column < COLUMNS; column += 1) {
        lay(row, column, column * width, width);
      }

      continue;
    }

    lay(row, 0, 0, width / 2);

    for (let column = 0; column < COLUMNS - 1; column += 1) {
      lay(row, column + 1, width / 2 + column * width, width);
    }

    lay(row, COLUMNS, span - width / 2, width / 2);
  }

  return bricks;
};

interface Chunk {
  instance: number;
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  spin: Vector3;
  thinnest: number;
}

interface ChunkBodyState {
  id: number;
  cell: Cell;
  shape: Jolt.Shape;
  material: MeshStandardMaterial;
  position: Vec3Tuple;
  rotation: QuatTuple;
  velocity: Vec3Tuple;
  spin: Vec3Tuple;
}

const placed = new Matrix4();
const NO_SCALE = new Vector3(1, 1, 1);
const turn = new Quaternion();
const spinAxis = new Vector3();

/**
 * What has come off the wall. A chunk collides with nothing, so it needs no Jolt
 * body: no hull to build as it breaks, and no pair to solve once it is loose. It
 * falls in plain JS and stops at the floor. One draw call however many there are.
 */
/**
 * With `collide`, each chunk is a body on the hull it had in the compound;
 * without, chunks are only drawn, falling in one `BatchedMesh` to the floor.
 */
const createChunks = (bricks: Brick[], collide: boolean) => {
  const shared = new Set(bricks.flatMap(({ cells }) => cells));
  const vertexCount = [...shared].reduce(
    (total, { geometry }) => total + geometry.getAttribute("position").count,
    0,
  );

  const instances = bricks.reduce(
    (total, { cells }) => total + cells.length,
    0,
  );

  let mesh: BatchedMesh | null = null;

  const build = () => {
    const built = new BatchedMesh(instances, vertexCount, 0, CHUNK_MATERIAL);
    built.frustumCulled = false;
    built.perObjectFrustumCulled = false;
    built.sortObjects = false;
    built.receiveShadow = true;

    for (const cell of shared) cell.batchId = built.addGeometry(cell.geometry);

    mesh = built;
    return built;
  };

  const falling: Chunk[] = [];
  const waitingBodies: ChunkBodyState[] = [];
  const heldShapes: Jolt.Shape[] = [];
  let nextBodyID = 0;
  let breaksLeft = MAX_BREAKS_PER_FRAME;

  const draw = (chunk: Chunk) => {
    placed.compose(chunk.position, chunk.rotation, NO_SCALE);
    mesh?.setMatrixAt(chunk.instance, placed);
  };

  const land = (chunk: Chunk) => {
    chunk.position.y = chunk.thinnest / 2;
    chunk.velocity.y *= -BOUNCE;
    chunk.velocity.x *= SCRAPE;
    chunk.velocity.z *= SCRAPE;
    chunk.spin.multiplyScalar(SCRAPE);
    return chunk.velocity.y < REST_SPEED;
  };

  const advance = (chunk: Chunk, delta: number) => {
    chunk.velocity.y -= GRAVITY * delta;
    chunk.position.addScaledVector(chunk.velocity, delta);

    const speed = chunk.spin.length();
    if (speed > 0) {
      spinAxis.copy(chunk.spin).divideScalar(speed);
      chunk.rotation.premultiply(turn.setFromAxisAngle(spinAxis, speed * delta));
    }

    return chunk.position.y < chunk.thinnest / 2 && land(chunk);
  };

  return {
    build,

    takeWaitingBodies: () => waitingBodies.splice(0),

    releaseHeldShapes: () => {
      for (const shape of heldShapes.splice(0)) shape.Release();
    },

    takeBreak: () => {
      if (breaksLeft <= 0) return false;
      breaksLeft -= 1;
      return true;
    },

    refillBreaks: () => {
      breaksLeft = MAX_BREAKS_PER_FRAME;
    },

    release: (
      cell: Cell,
      shape: Jolt.Shape,
      material: MeshStandardMaterial,
      position: Vector3,
      rotation: Quaternion,
      velocity: Vector3,
      spin: Vector3,
    ) => {
      if (collide) {
        // Held, since its brick may let go of it before the body is mounted.
        shape.AddRef();
        heldShapes.push(shape);

        nextBodyID += 1;
        waitingBodies.push({
          id: nextBodyID,
          cell,
          shape,
          material,
          position: [position.x, position.y, position.z],
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
          velocity: [velocity.x, velocity.y, velocity.z],
          spin: [spin.x, spin.y, spin.z],
        });
        return;
      }

      if (!mesh) return;

      const instance = mesh.addInstance(cell.batchId);
      mesh.setColorAt(instance, material.color);

      const chunk: Chunk = {
        instance,
        position,
        rotation,
        velocity,
        spin,
        thinnest: cell.thinnest,
      };

      draw(chunk);
      falling.push(chunk);
    },

    step: (delta: number) => {
      for (let index = falling.length - 1; index >= 0; index -= 1) {
        const chunk = falling[index];
        const stopped = advance(chunk, delta);
        draw(chunk);

        if (stopped) {
          falling[index] = falling[falling.length - 1];
          falling.pop();
        }
      }
    },
  };
};

type Chunks = ReturnType<typeof createChunks>;

/**
 * One brick, already in chunks. Breaking is driven from `useBodyContacts` rather
 * than `useContactListener` on purpose: this handler runs between steps, after
 * `Step()` has returned, so changing the shape is legal. Inside Jolt's own
 * callback it is not.
 */
const BrickBody = ({
  brick,
  chunks,
  onShattered,
}: {
  brick: Brick;
  chunks: Chunks;
  onShattered: () => void;
}) => {
  const [ref, api] = useMutableCompound({
    shapes: brick.shapes,
    position: brick.position,
    motionType: "dynamic",
    material: { friction: 0.75, restitution: 0.02 },
  });

  const [chipped, setChipped] = useState(false);
  const gone = useRef(false);
  const left = useRef([...brick.cells]);

  // A built wall has no reason to settle: a stack started awake leans a few cm.
  useEffect(() => {
    api?.sleep();
  }, [api]);

  const breakAt = (point: Vector3, deltaV: number) => {
    if (!api) return;

    // Every Body vector getter hands back the same wrapper, so each read is
    // copied out before the next one is made.
    const at = api.body.GetPosition();
    const position = new Vector3(at.GetX(), at.GetY(), at.GetZ());
    const facing = api.body.GetRotation();
    const rotation = new Quaternion(
      facing.GetX(),
      facing.GetY(),
      facing.GetZ(),
      facing.GetW(),
    );
    const centre = api.body.GetCenterOfMassPosition();
    const centreOfMass = new Vector3(
      centre.GetX(),
      centre.GetY(),
      centre.GetZ(),
    );
    const linear = api.body.GetLinearVelocity();
    const velocity = new Vector3(linear.GetX(), linear.GetY(), linear.GetZ());
    const angular = api.body.GetAngularVelocity();
    const spin = new Vector3(angular.GetX(), angular.GetY(), angular.GetZ());

    const hit = point.sub(position).applyQuaternion(rotation.clone().invert());
    const blastRadius = deltaV * BLAST_RADIUS_PER_DELTA_V;
    const distanceFromHit = ({ home }: Cell) =>
      hit.distanceTo(new Vector3(...home));

    const nearest = left.current.reduce((closest, cell) =>
      distanceFromHit(cell) < distanceFromHit(closest) ? cell : closest,
    );
    const freed = left.current.filter(
      (cell) => cell === nearest || distanceFromHit(cell) <= blastRadius,
    );

    // One chunk left is not a brick. Unmounting takes the whole body.
    const finished = left.current.length - freed.length <= 1;
    const going = finished ? left.current : freed;

    for (const [index, cell] of left.current.entries()) {
      if (!going.includes(cell)) continue;

      const local = new Vector3(...cell.home);
      const away = local.clone().sub(hit).normalize();
      const world = local.applyQuaternion(rotation).add(position);
      const lever = world.clone().sub(centreOfMass);

      chunks.release(
        cell,
        api.shape.GetSubShape(index).get_mShape(),
        brick.material,
        world,
        rotation.clone(),
        spin
          .clone()
          .cross(lever)
          .add(velocity)
          .addScaledVector(away.applyQuaternion(rotation), BLAST_KICK),
        spin.clone(),
      );
    }

    if (finished) {
      gone.current = true;
      onShattered();
      return;
    }

    // From the end: removing a child moves every later one down.
    for (let index = left.current.length - 1; index >= 0; index -= 1) {
      if (!freed.includes(left.current[index])) continue;
      api.removeShape(index);
      left.current.splice(index, 1);
    }

    api.adjustCenterOfMass();
    setChipped(true);
  };

  const onContact = (contact: ContactInfo) => {
    if (gone.current || !api) return;

    // Read every time: the mass falls with each chunk freed.
    const inverseMass = api.body.GetMotionProperties().GetInverseMass();
    const deltaV = contact.impulse * inverseMass;
    if (deltaV < BREAK_DELTA_V || !chunks.takeBreak()) return;

    // `ContactInfo` is pooled, so the point is copied first.
    breakAt(contact.point.clone(), deltaV);
  };

  // `onStay` as well as `onEnter`, because in a collapse most of the violence is
  // between bodies already touching, and those persist rather than re-enter; a
  // resting contact reads a closing speed of about zero, so a settled wall stays
  // quiet.
  useBodyContacts(
    api?.body,
    { onEnter: onContact, onStay: onContact },
    { contactForce: true },
  );

  return (
    <mesh
      ref={ref}
      geometry={chipped && api ? api.geometry : brick.solid}
      castShadow
      receiveShadow
    >
      <primitive object={brick.material} attach="material" />
    </mesh>
  );
};

/** State of its own, so a break re-renders this brick and not the whole wall. */
const BrickSlot = memo(function BrickSlot({
  brick,
  chunks,
}: {
  brick: Brick;
  chunks: Chunks;
}) {
  const [shattered, setShattered] = useState(false);

  return shattered ? null : (
    <BrickBody
      brick={brick}
      chunks={chunks}
      onShattered={() => setShattered(true)}
    />
  );
});

/** One group, one subgroup: Jolt has them ignore each other and nothing else. */
const CHUNK_GROUP = 1;

const ChunkBody = ({
  chunk,
  filter,
}: {
  chunk: ChunkBodyState;
  filter: Jolt.GroupFilter;
}) => {
  const [ref] = useBody(
    () => ({
      shape: finishShape(chunk.shape),
      geometry: chunk.cell.geometry,
    }),
    {
      position: chunk.position,
      rotation: chunk.rotation,
      motionType: "dynamic",
      initialVelocity: chunk.velocity,
      initialAngularVelocity: chunk.spin,
      material: { friction: 0.75, restitution: 0.02 },
      collisionGroup: { filter, groupID: CHUNK_GROUP },
    },
    "convex",
  );

  return (
    <mesh ref={ref} geometry={chunk.cell.geometry} receiveShadow>
      <primitive object={chunk.material} attach="material" />
    </mesh>
  );
};

/** Its own state, so a chunk arriving re-renders the chunks and not the wall. */
const ChunkBodies = ({ chunks }: { chunks: Chunks }) => {
  const [bodies, setBodies] = useState<ChunkBodyState[]>([]);
  const table = useGroupFilterTable(1);

  useFrame(() => {
    const arriving = chunks.takeWaitingBodies();
    if (arriving.length > 0) setBodies((current) => [...current, ...arriving]);
  });

  useEffect(() => () => chunks.releaseHeldShapes(), [chunks]);

  return table
    ? bodies.map((chunk) => (
        <ChunkBody key={chunk.id} chunk={chunk} filter={table.filter} />
      ))
    : null;
};

const Cannonball = ({ shot }: { shot: Shot }) => {
  const [ref] = useSphere({
    radius: SHOT_RADIUS,
    position: shot.position,
    motionType: "dynamic",
    mass: SHOT_MASS,
    initialVelocity: shot.velocity,
    motionQuality: "linearCast",
    material: { friction: 0.4, restitution: 0.1 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[SHOT_RADIUS, 20, 20]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.6} roughness={0.3} />
    </mesh>
  );
};

const SAMPLE_SECONDS = 0.4;

const Readout = () => {
  const { physicsSystem, Jolt: jolt } = useJolt();
  const [rate, setRate] = useState("warming up");
  const elapsed = useRef(0);
  const frames = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    frames.current += 1;

    if (elapsed.current < SAMPLE_SECONDS) return;

    setRate(
      `${Math.round(frames.current / elapsed.current)} fps · ` +
        `${physicsSystem.GetNumActiveBodies(jolt.EBodyType_RigidBody)} awake`,
    );

    elapsed.current = 0;
    frames.current = 0;
  });

  return (
    <Hud position={[0, 7.5, 0]}>{rate}</Hud>
  );
};

const buildScene = (startID: number, collide: boolean) => {
  const bricks = buildWall(startID);
  return { bricks, collide, chunks: createChunks(bricks, collide) };
};

export const Breakable = () => {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const raycaster = useThree((state) => state.raycaster);

  const nextID = useRef(1000);
  const takeID = useCallback(() => {
    nextID.current += 1;
    return nextID.current;
  }, []);

  const [{ bricks, collide, chunks }, setScene] = useState(() =>
    buildScene(0, true),
  );
  const [shots, setShots] = useState<Shot[]>([]);

  const chunkHolder = useRef<Group>(null);

  // Built here rather than with the scene: StrictMode runs this cleanup once on
  // mount, and a disposed `BatchedMesh` throws on the next `addInstance`.
  useEffect(() => {
    const holder = chunkHolder.current;
    if (!holder) return;

    const mesh = chunks.build();
    holder.add(mesh);

    return () => {
      holder.remove(mesh);
      mesh.dispose();
    };
  }, [chunks]);

  useAfterPhysicsStep((delta) => chunks.step(delta));

  useFrame(() => chunks.refillBreaks());

  const fire = useCallback(
    (ndc: Vector2) => {
      raycaster.setFromCamera(ndc, camera);

      const origin = raycaster.ray.origin
        .clone()
        .addScaledVector(raycaster.ray.direction, 1.5);
      const velocity = raycaster.ray.direction
        .clone()
        .multiplyScalar(SHOT_SPEED);

      setShots((current) => [
        ...current.slice(Math.max(0, current.length - (SHOT_CAP - 1))),
        {
          id: takeID(),
          position: [origin.x, origin.y, origin.z],
          velocity: [velocity.x, velocity.y, velocity.z],
        },
      ]);
    },
    [camera, raycaster, takeID],
  );

  // On the canvas rather than an invisible mesh: a shot should come from
  // wherever the camera is, and an orbit can put a mesh behind it.
  // `OrbitControls` shares the element and does not stop propagation.
  useEffect(() => {
    const down = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      down.x = event.clientX;
      down.y = event.clientY;
    };

    const onUp = (event: PointerEvent) => {
      // A drag orbits the camera; only a click fires.
      const travel = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (travel > CLICK_SLOP) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      fire(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
      );
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [canvas, fire]);

  const rebuild = useCallback(
    (chunksCollide: boolean) => {
      setScene(buildScene(takeID() * 100, chunksCollide));
      setShots([]);
    },
    [takeID],
  );

  return (
    <>
      <Floor size={40} />

      <Wall position={[-5.5, 2.6, 0]} size={[0.7, 5.2, 2.6]} />
      <Wall position={[5.5, 2.6, 0]} size={[0.7, 5.2, 2.6]} />

      {bricks.map((brick) => (
        <BrickSlot
          key={brick.id}
          brick={brick}
          chunks={chunks}
        />
      ))}

      <group ref={chunkHolder} />

      {collide && <ChunkBodies key={bricks[0].id} chunks={chunks} />}

      {shots.map((shot) => (
        <Cannonball key={shot.id} shot={shot} />
      ))}

      <Readout />

      <Controls position={[0, 6.8, 0]}>
        <button onClick={() => rebuild(collide)}>rebuild wall</button>
        <button aria-pressed={collide} onClick={() => rebuild(!collide)}>
          chunks collide {collide ? "on" : "off"}
        </button>
      </Controls>
    </>
  );
};
