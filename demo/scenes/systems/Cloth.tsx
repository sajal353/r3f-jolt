import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  PlaneGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Mesh,
} from "three";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCylinder } from "@/Jolt/useCylinder";
import { useSoftBody, type SoftBodyApi } from "@/Jolt/useSoftBody";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import type { Vec3Tuple } from "@/Jolt/types";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { BeachBall } from "../../shared/BeachBall";

const CLICK_SLOP = 4;
const SHOT_SPEED = 22;
const SHOT_RADIUS = 0.3;
const SHOT_CAP = 12;

const FLAG_WIDTH = 3;
const FLAG_HEIGHT = 2;
const POLE_X = -7;
const POLE_HEIGHT = 5.5;

const CURTAIN_WIDTH = 4;
const CURTAIN_HEIGHT = 3;
const CURTAIN_TOP = 4.2;
const CURTAIN_Z = -3;
const RAIL_RADIUS = 0.06;
const CURTAIN_THICKNESS = 0.06;

const TABLE_TOP = 1.1;

/** Paints `geometry` in bands of `colors`, by its first texture coordinate. */
const paintBands = (
  geometry: BufferGeometry,
  colors: readonly string[],
  axis: "u" | "v",
) => {
  const uv = geometry.getAttribute("uv");
  const paint = new Float32Array(uv.count * 3);
  const swatches = colors.map((color) => new Color(color));

  for (let index = 0; index < uv.count; index += 1) {
    const t = axis === "u" ? uv.getX(index) : uv.getY(index);
    // A sphere's pole vertices sit half a segment outside 0…1.
    const band = Math.min(
      colors.length - 1,
      Math.max(0, Math.floor(t * colors.length)),
    );
    swatches[band].toArray(paint, index * 3);
  }

  geometry.setAttribute("color", new BufferAttribute(paint, 3));
  return geometry;
};

type Register = (api: SoftBodyApi) => () => void;

/** Lists a soft body with the scene's hand while it is mounted. */
const useRegistered = (api: SoftBodyApi | undefined, register: Register) => {
  useEffect(() => {
    if (api) return register(api);
  }, [api, register]);
};

const Pole = () => {
  const [ref] = useBox({
    size: [0.16, POLE_HEIGHT, 0.16],
    position: [POLE_X, POLE_HEIGHT / 2, 0],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow>
      <cylinderGeometry args={[0.08, 0.08, POLE_HEIGHT, 12]} />
      <meshStandardMaterial color="#bdc3c7" metalness={0.6} roughness={0.3} />
    </mesh>
  );
};

const Flag = ({ onCreate }: { onCreate: Register }) => {
  const geometry = useMemo(
    () => new PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, 24, 16),
    [],
  );

  const [ref, api] = useSoftBody(geometry, {
    position: [POLE_X + FLAG_WIDTH / 2 + 0.1, POLE_HEIGHT - FLAG_HEIGHT / 2, 0],
    pinned: (point) => point.x < -FLAG_WIDTH / 2 + 0.01,
    mass: 1.5,
    // Floppier than this and the free corners whip at several times the wind.
    bendCompliance: 0.01,
    facesDoubleSided: true,
    allowSleeping: false,
  });

  useRegistered(api, onCreate);

  // Gusts, so the flag never settles into one shape.
  useFrame(function gust({ clock }) {
    const time = clock.elapsedTime;
    api?.setWind([
      3 + 1.2 * Math.sin(time * 0.9) + 0.5 * Math.sin(time * 2.7),
      0.2 * Math.sin(time * 1.3),
      // Wind only pushes along face normals, so air straight down the flag's
      // plane would leave it hanging; a crosswind is what lifts it.
      1.5 + Math.sin(time * 0.6),
    ]);
  });

  return (
    <mesh ref={ref} geometry={api?.geometry} castShadow>
      <meshStandardMaterial color="#c0392b" side={DoubleSide} roughness={0.8} />
    </mesh>
  );
};

const Post = ({ x }: { x: number }) => {
  const [ref] = useBox({
    size: [0.15, CURTAIN_TOP + 0.3, 0.15],
    position: [x, (CURTAIN_TOP + 0.3) / 2, CURTAIN_Z],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[0.15, CURTAIN_TOP + 0.3, 0.15]} />
      <meshStandardMaterial color="#6d4c41" />
    </mesh>
  );
};

/** Solid, so the swinging curtain folds over it instead of through it. */
const Rail = () => {
  const [ref] = useCylinder({
    radius: RAIL_RADIUS,
    height: CURTAIN_WIDTH + 0.6,
    // Clear of the pinned row's vertexRadius, or the two fight forever.
    position: [0, CURTAIN_TOP + RAIL_RADIUS + CURTAIN_THICKNESS + 0.03, CURTAIN_Z],
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    motionType: "static",
  });

  return (
    <mesh ref={ref} castShadow>
      <cylinderGeometry args={[RAIL_RADIUS, RAIL_RADIUS, CURTAIN_WIDTH + 0.6, 12]} />
      <meshStandardMaterial color="#6d4c41" />
    </mesh>
  );
};

interface Hit {
  id: number;
  point: Vector3;
}

const Curtain = ({
  onCreate,
  onHit,
}: {
  onCreate: Register;
  onHit: (point: Vector3) => void;
}) => {
  const geometry = useMemo(
    () =>
      paintBands(
        new PlaneGeometry(CURTAIN_WIDTH, CURTAIN_HEIGHT, 28, 21),
        ["#8e44ad", "#9b59b6"],
        "u",
      ),
    [],
  );

  const [ref, api] = useSoftBody(geometry, {
    position: [0, CURTAIN_TOP - CURTAIN_HEIGHT / 2, CURTAIN_Z],
    pinned: (point) => point.y > CURTAIN_HEIGHT / 2 - 0.01,
    mass: 3,
    lra: "geodesic",
    // Tethers at exactly the rest length fight the edges and the top rows
    // tremble; a little slack and some bending stiffness let it settle.
    lraMaxDistanceMultiplier: 1.02,
    bendCompliance: 0.1,
    facesDoubleSided: true,
    // Thick enough that a ball stretching the cloth around itself does not
    // show through the faces between vertices.
    vertexRadius: CURTAIN_THICKNESS,
  });

  useRegistered(api, onCreate);

  useBodyContacts(api?.body, {
    onEnter: (contact) => onHit(contact.point.clone()),
  });

  return (
    <>
      <Post x={-CURTAIN_WIDTH / 2 - 0.15} />
      <Post x={CURTAIN_WIDTH / 2 + 0.15} />
      <Rail />
      <mesh ref={ref} geometry={api?.geometry} castShadow receiveShadow>
        <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.9} />
      </mesh>
    </>
  );
};

const Table = () => {
  const [ref] = useBox({
    size: [2.4, TABLE_TOP, 1.6],
    position: [6, TABLE_TOP / 2, 0],
    motionType: "static",
    material: { friction: 1 },
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[2.4, TABLE_TOP, 1.6]} />
      <meshStandardMaterial color="#795548" />
    </mesh>
  );
};

const Tablecloth = ({ onCreate }: { onCreate: Register }) => {
  const geometry = useMemo(() => {
    const sheet = paintBands(
      new PlaneGeometry(3.2, 3.2, 24, 24),
      ["#ecf0f1", "#e74c3c", "#ecf0f1", "#e74c3c", "#ecf0f1"],
      "u",
    );
    return sheet.rotateX(-Math.PI / 2);
  }, []);

  const [ref, api] = useSoftBody(geometry, {
    position: [6, TABLE_TOP + 1.5, 0],
    rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
    mass: 1,
    // Collision is per vertex, so a floppier cloth lets the table's edge slip
    // between vertices and flicks folds up off it.
    bendCompliance: 0.01,
    vertexRadius: 0.02,
    friction: 1,
    facesDoubleSided: true,
  });

  useRegistered(api, onCreate);

  return (
    <mesh ref={ref} geometry={api?.geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.9} />
    </mesh>
  );
};

const Jelly = ({ onCreate }: { onCreate: Register }) => {
  const geometry = useMemo(() => new BoxGeometry(1.2, 1.2, 1.2, 5, 5, 5), []);

  const [ref, api] = useSoftBody(geometry, {
    position: [-3, 2, 2.5],
    pressure: 40,
    mass: 2,
    // Dihedral bending remembers the cube's edges, so a squashed jelly springs
    // back square instead of rounding off.
    bend: "dihedral",
    bendCompliance: 1e-3,
    friction: 0.8,
  });

  useRegistered(api, onCreate);

  return (
    <mesh ref={ref} geometry={api?.geometry} castShadow>
      <meshPhysicalMaterial
        color="#2ecc71"
        roughness={0.15}
        transmission={0.3}
        thickness={0.8}
      />
    </mesh>
  );
};

interface Shot {
  id: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

const Ball = ({ shot }: { shot: Shot }) => {
  const [ref] = useSphere({
    radius: SHOT_RADIUS,
    position: shot.position,
    initialVelocity: shot.velocity,
    motionType: "dynamic",
    mass: 3,
    motionQuality: "linearCast",
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[SHOT_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.5} roughness={0.3} />
    </mesh>
  );
};

const Marker = ({ point }: { point: Vector3 }) => {
  const ref = useRef<Mesh>(null);

  useFrame(function fade(_, delta) {
    const mesh = ref.current;
    if (!mesh) return;
    const next = Math.max(0, mesh.scale.x - delta * 0.8);
    mesh.scale.setScalar(next);
  });

  return (
    <mesh ref={ref} position={point}>
      <sphereGeometry args={[0.12, 12, 12]} />
      <meshBasicMaterial color="#f1c40f" />
    </mesh>
  );
};

/** A click (not a drag, which orbits) throws a ball from the camera. */
const useShots = () => {
  const canvas = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera);
  const raycaster = useThree((state) => state.raycaster);
  const [shots, setShots] = useState<Shot[]>([]);
  const nextID = useRef(0);

  useEffect(() => {
    const down = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      down.x = event.clientX;
      down.y = event.clientY;
    };

    const onUp = (event: PointerEvent) => {
      const travel = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (travel > CLICK_SLOP) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const origin = raycaster.ray.origin
        .clone()
        .addScaledVector(raycaster.ray.direction, 1);
      const velocity = raycaster.ray.direction.clone().multiplyScalar(SHOT_SPEED);
      nextID.current += 1;
      const shot: Shot = {
        id: nextID.current,
        position: [origin.x, origin.y, origin.z],
        velocity: [velocity.x, velocity.y, velocity.z],
      };
      setShots((current) => [
        ...current.slice(Math.max(0, current.length - (SHOT_CAP - 1))),
        shot,
      ]);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [canvas, camera, raycaster]);

  return shots;
};

export const Cloth = () => {
  const [cloths, setCloths] = useState<SoftBodyApi[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [round, setRound] = useState(0);
  const hitID = useRef(0);

  const register = useMemo<Register>(
    () => (api) => {
      setCloths((current) => [...current, api]);
      return () => setCloths((current) => current.filter((cloth) => cloth !== api));
    },
    [],
  );

  const onHit = useMemo(
    () => (point: Vector3) => {
      hitID.current += 1;
      const id = hitID.current;
      setHits((current) => [...current.slice(-7), { id, point }]);
    },
    [],
  );

  const shots = useShots();
  const vertices = cloths.reduce((total, cloth) => total + cloth.vertexCount, 0);

  return (
    <>
      <Floor size={40} />

      <Pole />
      <Flag onCreate={register} />
      <Curtain onCreate={register} onHit={onHit} />
      <Table />
      <Tablecloth key={`cloth-${round}`} onCreate={register} />
      <BeachBall
        key={`ball-${round}`}
        position={[2.5, 3, 2.5]}
        onCreate={register}
      />
      <Jelly key={`jelly-${round}`} onCreate={register} />

      {shots.map((shot) => (
        <Ball key={shot.id} shot={shot} />
      ))}
      {hits.map((hit) => (
        <Marker key={hit.id} point={hit.point} />
      ))}

      <Tag position={[POLE_X + 1.5, POLE_HEIGHT + 0.6, 0]}>flag · wind</Tag>
      <Tag position={[0, CURTAIN_TOP + 0.6, CURTAIN_Z]}>
        curtain · geodesic LRA
      </Tag>
      <Tag position={[6, TABLE_TOP + 2.6, 0]}>tablecloth · vertexRadius</Tag>

      <Controls position={[6, 4.6, 0]}>
        <button onClick={() => setRound((count) => count + 1)}>drop again</button>
      </Controls>
      <Hud position={[0, 7.5, 0]}>
        {cloths.length} soft bodies · {vertices} vertices
      </Hud>
    </>
  );
};
