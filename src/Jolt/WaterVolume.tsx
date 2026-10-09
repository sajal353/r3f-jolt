import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { BoxGeometry, EdgesGeometry, Vector3 } from "three";
import { useJolt } from "./useJolt";
import { useDebugFlag } from "./internal/debugView";
import { DEBUG_RENDER_ORDER } from "./internal/debugMaterial";
import type {
  Vec3Input,
  WaterEventHandler,
  WaterVolumeEntry,
  WaveHeight,
} from "./types";

export interface WaterVolumeProps {
  /** Centre of the box. */
  position?: Vec3Input;
  size: Vec3Input;
  /** World height of the surface, its mean with `waves`. Defaults to the top of the box. */
  surfaceLevel?: number;
  /**
   * Moves the surface: its height above `surfaceLevel` at a point, on the
   * physics clock. Bodies ride it, tilted to its slope. Leave room in `size`
   * above `surfaceLevel` for the crests.
   */
  waves?: WaveHeight;
  /** Relative to each body's own density: 1 hovers, above floats, below sinks. */
  buoyancy?: number;
  linearDrag?: number;
  angularDrag?: number;
  /** Velocity of the water itself, which drag pulls bodies towards. */
  flow?: Vec3Input;
  /** Where volumes overlap, the highest priority owns the body; ties go to the first mounted. */
  priority?: number;
  /** Object layer the volume looks for bodies on, read once. Defaults to what static bodies see. */
  layer?: number;
  onEnter?: WaterEventHandler;
  onExit?: WaterEventHandler;
  debug?: boolean;
  /** Drawn at the centre of the box. */
  children?: ReactNode;
}

const read = (value: Vec3Input) =>
  Array.isArray(value) ? value : [value.x, value.y, value.z];

const createEntry = (layer: number): WaterVolumeEntry => ({
  min: new Vector3(),
  max: new Vector3(),
  surfaceLevel: 0,
  buoyancy: 1.2,
  linearDrag: 0.5,
  angularDrag: 0.05,
  flow: new Vector3(),
  priority: 0,
  layer,
  changed: true,
});

/**
 * A box of water. Bodies inside it float, are dragged towards `flow`, and
 * report crossings through `onEnter`/`onExit` here and
 * `onEnterWater`/`onExitWater` on the body. Every prop is live.
 *
 * Buoyancy runs before each physics step, not each frame. Only the bounding
 * box picks bodies, and the surface is level in world space.
 */
export const WaterVolume = ({
  position = [0, 0, 0],
  size,
  surfaceLevel,
  waves,
  buoyancy = 1.2,
  linearDrag = 0.5,
  angularDrag = 0.05,
  flow,
  priority = 0,
  layer,
  onEnter,
  onExit,
  debug,
  children,
}: WaterVolumeProps) => {
  const api = useJolt();
  const entryRef = useRef(createEntry(layer ?? api.layers.LAYER_NON_MOVING));

  const [x, y, z] = read(position);
  const [width, height, depth] = read(size);
  const [flowX, flowY, flowZ] = flow ? read(flow) : [0, 0, 0];
  const top = y + height / 2;
  const level = surfaceLevel ?? top;

  useEffect(
    function applyRegion() {
      const entry = entryRef.current;
      entry.min.set(x - width / 2, y - height / 2, z - depth / 2);
      entry.max.set(x + width / 2, top, z + depth / 2);
      entry.surfaceLevel = level;
      entry.flow.set(flowX, flowY, flowZ);
      entry.priority = priority;
      entry.buoyancy = buoyancy;
      entry.linearDrag = linearDrag;
      entry.angularDrag = angularDrag;
      entry.changed = true;
    },
    [
      x,
      y,
      z,
      width,
      height,
      depth,
      top,
      level,
      flowX,
      flowY,
      flowZ,
      priority,
      buoyancy,
      linearDrag,
      angularDrag,
    ],
  );

  useEffect(function applyHandlers() {
    const entry = entryRef.current;
    entry.waves = waves;
    entry.onEnter = onEnter;
    entry.onExit = onExit;
  });

  useEffect(() => api.water.addVolume(entryRef.current), [api]);

  const showDebug = useDebugFlag(debug);

  return (
    <group position={[x, y, z]}>
      {showDebug && (
        <WaterDebug size={[width, height, depth]} surface={level - y} />
      )}
      {children}
    </group>
  );
};

const WaterDebug = ({
  size: [width, height, depth],
  surface,
}: {
  size: [number, number, number];
  surface: number;
}) => {
  const edges = useMemo(
    function buildEdges() {
      const box = new BoxGeometry(width, height, depth);
      const outline = new EdgesGeometry(box);
      box.dispose();
      return outline;
    },
    [width, height, depth],
  );

  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <>
      <lineSegments geometry={edges} renderOrder={DEBUG_RENDER_ORDER}>
        <lineBasicMaterial color="deepskyblue" depthTest={false} />
      </lineSegments>
      <mesh
        position={[0, surface, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={DEBUG_RENDER_ORDER}
      >
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color="deepskyblue"
          wireframe
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </>
  );
};
