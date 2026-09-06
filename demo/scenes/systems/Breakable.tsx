import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { ConvexObjectBreaker } from "three/examples/jsm/misc/ConvexObjectBreaker.js";
import { Controls, Floor, Hud, Wall } from "../../shared/Stage";
import { useConvex } from "@/Jolt/useConvex";
import { useSphere } from "@/Jolt/useSphere";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useJolt } from "@/Jolt/useJolt";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ContactInfo, QuatTuple, Vec3Tuple } from "@/Jolt/types";

/** A 215 x 65 x 102.5 mm brick at x5.6. The proportions are what read as a wall. */
const BRICK: Vec3Tuple = [1.2, 0.36, 0.57];
const COLUMNS = 8;
const ROWS = 13;

/** `MIN_SIZE` stops a sliver becoming two; `MAX_DEPTH` caps the generations. */
const MIN_SIZE = 0.35;
const MAX_DEPTH = 2;
const DEBRIS_CAP = 200;

/**
 * How much velocity the estimated impulse would give this piece, in m/s.
 * Mass-relative on purpose: `impulse` is closing momentum, so one collision
 * reads 3000 against a 246 kg brick and 119 against a 40 kg chunk off it, and
 * no absolute number breaks both. Measured — settling peaks at 0.26, a
 * cannonball gives what it hits about 11, a brick landing off the top 9.6.
 */
const BREAK_DELTA_V = 0.8;

/**
 * Fragments under this are dropped rather than bodied. Jolt refuses a hull this
 * small outright ("initial triangle area too small") and asserts on the inertia
 * of one only slightly larger; both are dust, and dust costs a slot.
 */
const MIN_CHIP_VOLUME = 1e-5;
const MIN_CHIP_THICKNESS = 0.005;

/** Jolt asserts past its own ~47 rad/s cap rather than clamping to it. */
const MAX_SPIN = 20;

/**
 * A collapsing wall wants to break a dozen pieces in one contact flush. Each
 * one past this stays armed and goes on a later frame, which spreads the body
 * churn instead of spending it all in the frame the wall lands.
 */
const MAX_BREAKS_PER_FRAME = 6;

/** Cuts per impact, radial then random. More cuts, smaller chunks, more of them. */
const RADIAL_CUTS = 2;
const RANDOM_CUTS = 1;

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

const DEBRIS_MATERIAL = new MeshStandardMaterial({
  color: "#6f4230",
  roughness: 0.95,
});

const shadeFor = (row: number, column: number) =>
  BRICK_MATERIALS[(row * 3 + column * 2) % BRICK_MATERIALS.length];

interface Piece {
  id: number;
  geometry: BufferGeometry;
  vertices: number[][];
  /** Bounding-box volume. A proxy, and only ever used to order retirement. */
  size: number;
  material: MeshStandardMaterial;
  position: Vec3Tuple;
  rotation: QuatTuple;
  velocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
  breakable: boolean;
  depth: number;
}

interface Shot {
  id: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

const readGeometry = (geometry: BufferGeometry) => {
  const position = geometry.getAttribute("position");
  const vertices: number[][] = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < position.count; index += 1) {
    const point = [
      position.getX(index),
      position.getY(index),
      position.getZ(index),
    ];

    vertices.push(point);

    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }

  const extents = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

  return {
    vertices,
    size: extents[0] * extents[1] * extents[2],
    thinnest: Math.min(...extents),
  };
};

/**
 * A running bond — alternate courses offset by half a brick and closed at both
 * ends by a half one, so no vertical joint runs through the wall. Nothing bonds
 * them: it is a dry stack standing on friction and its own weight. Courses are
 * laid touching rather than gapped, which is what took the settling impulse
 * from 217 down to 50. 7 x 8 + 6 x 9 = 110 bricks.
 */
const buildWall = (startID: number): Piece[] => {
  const pieces: Piece[] = [];
  const [width, height, thickness] = BRICK;
  const span = COLUMNS * width;

  const lay = (row: number, column: number, left: number, brick: number) => {
    const geometry = new BoxGeometry(brick, height, thickness);
    const { vertices, size } = readGeometry(geometry);

    pieces.push({
      id: startID + pieces.length,
      geometry,
      vertices,
      size,
      material: shadeFor(row, column),
      position: [left + brick / 2 - span / 2, height / 2 + row * height, 0],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      breakable: true,
      depth: 0,
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

  return pieces;
};

/**
 * Smallest first, and never a standing brick — the wall should not dissolve
 * because the far end of it was knocked about. Equal sizes keep list order.
 */
const retireSmallest = (pieces: Piece[]): Piece[] => {
  const excess = pieces.length - DEBRIS_CAP;
  if (excess <= 0) return pieces;

  const doomed = new Set(
    pieces
      .filter((entry) => entry.depth > 0)
      .sort((first, second) => first.size - second.size)
      .slice(0, excess)
      .map((entry) => entry.id),
  );

  return pieces.filter((entry) => {
    if (!doomed.has(entry.id)) return true;
    entry.geometry.dispose();
    return false;
  });
};

/**
 * One body of the wall, brick or gravel. Breaking is driven from
 * `useBodyContacts` rather than `useContactListener` on purpose: this handler
 * runs between steps, after `Step()` has returned, so destroying a body and
 * creating six from it is legal. Inside Jolt's own callback it is not.
 */
const PieceBody = ({
  piece,
  onBreak,
}: {
  piece: Piece;
  onBreak: (
    piece: Piece,
    api: BodyApi<never>,
    point: Vector3,
    normal: Vector3,
  ) => boolean;
}) => {
  const { objectLayer, groups } = useJolt();

  const canBreak = piece.breakable && piece.depth < MAX_DEPTH;

  const [ref, api] = useConvex({
    vertices: piece.vertices,
    position: piece.position,
    rotation: piece.rotation,
    motionType: "dynamic",
    initialVelocity: piece.velocity,
    initialAngularVelocity: piece.angularVelocity,
    // Gravel sees the static world and nothing else — not the wall, not the
    // cannonballs, not the rest of the gravel. It has nothing left to do but
    // land and sleep, and debris against debris is what the pair count is made
    // of once the floor is covered. The cost is chips resting inside each other.
    layer: canBreak
      ? undefined
      : objectLayer(groups.GROUP_MOVING, groups.GROUP_NON_MOVING),
    material: { friction: 0.75, restitution: 0.02 },
  });

  const broken = useRef(false);
  const inverseMass = useRef(0);

  const onContact = (contact: ContactInfo) => {
    if (broken.current || !api) return;

    if (inverseMass.current === 0) {
      inverseMass.current = api.body.GetMotionProperties().GetInverseMass();
    }

    if (contact.impulse * inverseMass.current < BREAK_DELTA_V) return;

    // `ContactInfo` is pooled, so both vectors are copied first. The normal
    // points from this piece towards whatever hit it, so the blow came the
    // other way.
    broken.current = onBreak(
      piece,
      api as unknown as BodyApi<never>,
      contact.point.clone(),
      contact.normal.clone().negate(),
    );
  };

  // Gravel neither subscribes nor casts a shadow: `contactForce` is about ten
  // calls into WASM per contact per step, and a shadow pass over every chip
  // costs more than the chips are worth. `onStay` as well as `onEnter`,
  // because in a collapse most of the violence is between bodies already
  // touching, and those persist rather than re-enter; a resting contact reads a
  // closing speed of about zero, so a settled wall stays quiet.
  useBodyContacts(
    canBreak ? api?.body : undefined,
    { onEnter: onContact, onStay: onContact },
    { contactForce: true },
  );

  return (
    <mesh ref={ref} castShadow={canBreak} receiveShadow>
      <primitive object={piece.geometry} attach="geometry" />
      <primitive object={piece.material} attach="material" />
    </mesh>
  );
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

const Readout = ({ pieces, breaks }: { pieces: number; breaks: number }) => {
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
    <Hud position={[0, 8.4, 0]}>
      {pieces} pieces of {DEBRIS_CAP} · {breaks} breaks · {rate}
    </Hud>
  );
};

export const Breakable = () => {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const raycaster = useThree((state) => state.raycaster);

  const breaker = useMemo(() => new ConvexObjectBreaker(MIN_SIZE), []);

  const nextID = useRef(1000);
  const takeID = useCallback(() => {
    nextID.current += 1;
    return nextID.current;
  }, []);

  const [pieces, setPieces] = useState<Piece[]>(() => buildWall(0));
  const piecesRef = useRef<Piece[]>(pieces);
  const [shots, setShots] = useState<Shot[]>([]);
  const [breaks, setBreaks] = useState(0);

  const commit = useCallback((next: Piece[]) => {
    piecesRef.current = next;
    setPieces(next);
  }, []);

  /**
   * Breaks are collected and applied once a frame. Committing per break
   * re-renders every piece in the scene, and a wall coming down produces a
   * dozen breaks in a single contact flush.
   */
  const pending = useRef<{ removed: Set<number>; added: Piece[] }>({
    removed: new Set(),
    added: [],
  });
  const budget = useRef(MAX_BREAKS_PER_FRAME);

  const onBreak = useCallback(
    (piece: Piece, api: BodyApi<never>, point: Vector3, normal: Vector3) => {
      if (budget.current <= 0) return false;

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
      const linear = api.body.GetLinearVelocity();
      const velocity = new Vector3(linear.GetX(), linear.GetY(), linear.GetZ());
      const spin = api.body.GetAngularVelocity();
      const angularVelocity = new Vector3(
        spin.GetX(),
        spin.GetY(),
        spin.GetZ(),
      );

      const spinning = angularVelocity.length();
      if (spinning > MAX_SPIN) {
        angularVelocity.multiplyScalar(MAX_SPIN / spinning);
      }

      const source = new Mesh(piece.geometry, piece.material);
      source.position.copy(position);
      source.quaternion.copy(rotation);

      // Mass is only used by the breaker to halve itself per cut, which is not
      // a number worth carrying: the fragments take theirs from the shape.
      breaker.prepareBreakableObject(source, 1, velocity, angularVelocity, true);

      // A cut that grazes a face leaves more than four points with no volume,
      // and `ConvexGeometry` throws building a hull out of them. The piece is
      // left standing, and armed, rather than half-replaced.
      let debris: Object3D[];

      try {
        debris = breaker.subdivideByImpact(
          source,
          point,
          normal,
          RADIAL_CUTS,
          RANDOM_CUTS,
        );
      } catch {
        return false;
      }

      if (debris.length < 2) return false;

      const fragments: Piece[] = [];

      for (const object of debris) {
        const mesh = object as Mesh;

        // The breaker adds each fragment's local centroid to the parent's
        // *position* without applying the parent's rotation — correct for an
        // untouched wall, half a body out for anything that has tumbled.
        mesh.position
          .sub(source.position)
          .applyQuaternion(source.quaternion)
          .add(source.position);

        const geometry = mesh.geometry;
        const { vertices, size, thinnest } = readGeometry(geometry);

        if (size < MIN_CHIP_VOLUME || thinnest < MIN_CHIP_THICKNESS) {
          geometry.dispose();
          continue;
        }

        fragments.push({
          id: takeID(),
          geometry,
          vertices,
          size,
          material: DEBRIS_MATERIAL,
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [
            mesh.quaternion.x,
            mesh.quaternion.y,
            mesh.quaternion.z,
            mesh.quaternion.w,
          ],
          velocity: [velocity.x, velocity.y, velocity.z],
          angularVelocity: [
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
          ],
          breakable: mesh.userData.breakable === true,
          depth: piece.depth + 1,
        });
      }

      // The split was all dust. Leave the piece whole and still armed.
      if (fragments.length === 0) return false;

      pending.current.removed.add(piece.id);
      pending.current.added.push(...fragments);
      budget.current -= 1;
      return true;
    },
    [breaker, takeID],
  );

  // Priority 0, so it runs after `<Physics>` has stepped and flushed its
  // contacts: every break of this frame is in hand by the time it lands.
  useFrame(() => {
    const { removed, added } = pending.current;
    budget.current = MAX_BREAKS_PER_FRAME;

    if (removed.size === 0) return;

    const kept = piecesRef.current.filter((entry) => {
      if (!removed.has(entry.id)) return true;
      // Disposed here rather than as the break happens: the mesh is still
      // rendered until this commit takes it out of the tree.
      entry.geometry.dispose();
      return false;
    });

    commit(retireSmallest([...kept, ...added]));
    setBreaks((count) => count + removed.size);
    pending.current = { removed: new Set(), added: [] };
  });

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

  const reset = useCallback(() => {
    for (const piece of piecesRef.current) piece.geometry.dispose();
    for (const piece of pending.current.added) piece.geometry.dispose();
    pending.current = { removed: new Set(), added: [] };
    commit(buildWall(takeID() * 100));
    setShots([]);
    setBreaks(0);
  }, [commit, takeID]);

  return (
    <>
      <Floor size={40} />

      <Wall position={[-5.5, 2.6, 0]} size={[0.7, 5.2, 2.6]} />
      <Wall position={[5.5, 2.6, 0]} size={[0.7, 5.2, 2.6]} />

      {pieces.map((piece) => (
        <PieceBody key={piece.id} piece={piece} onBreak={onBreak} />
      ))}

      {shots.map((shot) => (
        <Cannonball key={shot.id} shot={shot} />
      ))}

      <Readout pieces={pieces.length} breaks={breaks} />

      <Controls position={[0, 7.6, 0]}>
        <button onClick={reset}>rebuild wall</button>
      </Controls>
    </>
  );
};
