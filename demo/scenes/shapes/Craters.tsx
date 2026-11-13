import { useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Controls, Hud } from "../../shared/Stage";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useHeightField } from "@/Jolt/useHeightField";
import { useSphere } from "@/Jolt/useSphere";
import type { Vec3Tuple } from "@/Jolt/types";

const SAMPLES = 64;
const BLOCK = 4;
const SPACING = 0.5;
const SPAN = (SAMPLES - 1) * SPACING;

const CRATER_RADIUS = 3;
const CRATER_DEPTH = 1.8;
/** How far out the thrown-up rim reaches, as a share of the radius. */
const RIM_REACH = 1.6;
const RIM_HEIGHT = 0.4;
const RIM_WIDTH = 0.25;

const SHELL_RADIUS = 0.3;
const SHELL_DROP = 13;
const SHELL_SPEED = 16;

/** A pointer that moved this far between down and up was an orbit. */
const CLICK_SLOP = 6;

const BALL_RADIUS = 0.45;
const BALL_COLORS = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71"];

const groundAt = (x: number, z: number) =>
  0.5 * Math.sin(x * 0.17) * Math.cos(z * 0.14);

/** Flat where it meets the ground and at the crest, so no ridge shows at the edge. */
const craterProfile = (distance: number) => {
  const bowl = distance < 1 ? (1 - distance * distance) ** 2 : 0;
  const rim = Math.exp(-(((distance - 1) / RIM_WIDTH) ** 2));
  return RIM_HEIGHT * rim - CRATER_DEPTH * bowl;
};

const worldAt = (sample: number) => sample * SPACING - SPAN / 2;
const sampleAt = (world: number) => (world + SPAN / 2) / SPACING;

const BALLS: { start: Vec3Tuple; color: string }[] = Array.from(
  { length: 25 },
  (_, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const sampleX = 20 + column * 6;
    const sampleZ = 22 + row * 5;

    return {
      start: [
        worldAt(sampleX),
        groundAt(sampleX, sampleZ) + BALL_RADIUS + 0.4,
        worldAt(sampleZ),
      ],
      color: BALL_COLORS[index % BALL_COLORS.length],
    };
  },
);

const Ball = ({ start, color }: { start: Vec3Tuple; color: string }) => {
  const [ref] = useSphere({
    radius: BALL_RADIUS,
    position: start,
    motionType: "dynamic",
    angularDamping: 0.6,
    material: { friction: 0.8 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[BALL_RADIUS, 20, 20]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Shell = ({
  x,
  z,
  onLand,
}: {
  x: number;
  z: number;
  onLand: (x: number, z: number) => void;
}) => {
  const [ref, api] = useSphere({
    radius: SHELL_RADIUS,
    position: [x, SHELL_DROP, z],
    motionType: "dynamic",
    mass: 20,
    initialVelocity: [0, -SHELL_SPEED, 0],
    motionQuality: "linearCast",
  });

  const landed = useRef(false);

  useBodyContacts(api?.body, {
    onEnter: (contact) => {
      if (landed.current) return;
      landed.current = true;
      onLand(contact.point.x, contact.point.z);
    },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[SHELL_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.6} roughness={0.3} />
    </mesh>
  );
};

export const Craters = () => {
  const [generation, setGeneration] = useState(0);
  const [shells, setShells] = useState<
    { id: number; x: number; z: number }[]
  >([]);
  const [craters, setCraters] = useState(0);
  const nextShell = useRef(0);
  const pressedAt = useRef({ x: 0, y: 0 });

  const [ref, terrain] = useHeightField({
    heights: groundAt,
    sampleCount: SAMPLES,
    blockSize: BLOCK,
    sampleScale: [SPACING, 1, SPACING],
    offset: [-SPAN / 2, 0, -SPAN / 2],
    // Room below the ground to dig into. The field cannot store past this.
    range: [-8, 4],
    position: [0, 0, 0],
    material: { friction: 0.8 },
  });

  const dig = (x: number, z: number) => {
    if (!terrain) return;

    const centreX = sampleAt(x);
    const centreZ = sampleAt(z);
    const reach = (CRATER_RADIUS * RIM_REACH) / SPACING + BLOCK;

    // Whole blocks only, and the patch must clear the rim on every side.
    const startX = Math.max(0, Math.floor((centreX - reach) / BLOCK) * BLOCK);
    const startZ = Math.max(0, Math.floor((centreZ - reach) / BLOCK) * BLOCK);
    const endX = Math.min(SAMPLES, Math.ceil((centreX + reach) / BLOCK) * BLOCK);
    const endZ = Math.min(SAMPLES, Math.ceil((centreZ + reach) / BLOCK) * BLOCK);
    const sizeX = endX - startX;
    const sizeZ = endZ - startZ;
    if (sizeX <= 0 || sizeZ <= 0) return;

    const patch = terrain.getHeights(startX, startZ, sizeX, sizeZ);

    for (let row = 0; row < sizeZ; row += 1) {
      for (let column = 0; column < sizeX; column += 1) {
        const distance =
          (Math.hypot(startX + column - centreX, startZ + row - centreZ) *
            SPACING) /
          CRATER_RADIUS;

        if (distance < RIM_REACH) {
          patch[row * sizeX + column] += craterProfile(distance);
        }
      }
    }

    terrain.setHeights(startX, startZ, sizeX, sizeZ, patch);
    setCraters((value) => value + 1);
  };

  const drop = (x: number, z: number) => {
    nextShell.current += 1;
    const shell = { id: nextShell.current, x, z };
    setShells((current) => [...current, shell]);
  };

  const land = (id: number, x: number, z: number) => {
    dig(x, z);
    setShells((current) => current.filter((shell) => shell.id !== id));
  };

  const dropAtRandom = () => {
    drop((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12 - 1);
  };

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    pressedAt.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    const travel = Math.hypot(
      event.clientX - pressedAt.current.x,
      event.clientY - pressedAt.current.y,
    );
    if (travel <= CLICK_SLOP) drop(event.point.x, event.point.z);
  };

  return (
    <>
      {terrain && (
        <mesh
          ref={ref}
          geometry={terrain.geometry}
          receiveShadow
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          <meshStandardMaterial color="#6b6e3f" flatShading />
        </mesh>
      )}

      {BALLS.map(({ start, color }, index) => (
        <Ball key={`${generation}-${index}`} start={start} color={color} />
      ))}

      {shells.map((shell) => (
        <Shell
          key={shell.id}
          x={shell.x}
          z={shell.z}
          onLand={(x, z) => land(shell.id, x, z)}
        />
      ))}

      <Hud position={[8, 5.4, 0]}>
        {craters} {craters === 1 ? "crater" : "craters"}
      </Hud>

      <Controls position={[0, -1, 8]}>
        <button onClick={dropAtRandom}>drop a shell</button>
        <button onClick={() => setGeneration((value) => value + 1)}>
          new balls
        </button>
      </Controls>
    </>
  );
};
