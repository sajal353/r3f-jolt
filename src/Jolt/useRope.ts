import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineSegments,
  Quaternion,
  Sphere,
  type Curve,
  type Object3D,
  type Vector3,
} from "three";
import { useJolt } from "./useJolt";
import {
  createRodSettings,
  packStrands,
  readRodRotation,
  strandFromCurve,
  strandFromPoints,
  type RodStrands,
  type RodTopology,
} from "./internal/rodBuild";
import { dragSegments } from "./internal/rodAir";
import {
  addAirPass,
  createSoftBodyBaseApi,
  createSoftBodyHandle,
  requireRoomForBody,
  useAir,
  useLiveSoftBodyOptions,
  type SoftBodyBaseApi,
  type SoftBodyBodyOptions,
  type SoftBodyHandle,
} from "./internal/softBodyLifecycle";
import type { LRAType } from "./internal/softBodyBuild";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./internal/debugView";
import {
  createDebugLineMaterial,
  disposeDebugMaterial,
  DEBUG_RENDER_ORDER,
} from "./internal/debugMaterial";
import { useWaterBody } from "./internal/useBody";
import type { Vec3Tuple } from "./types";

export type RopePin = "start" | "end" | "both" | readonly number[];

export interface UseRopeOptions extends Omit<SoftBodyBodyOptions, "vertexRadius"> {
  /** The rope's shape at rest, relative to `position`. */
  points?: readonly Vec3Tuple[];
  /** In place of `points`; sampled at `segments` equal lengths. */
  curve?: Curve<Vector3>;
  /**
   * Resamples `points` into this many equal segments; with `curve`, default
   * 16. Left out, each point is a vertex.
   */
  segments?: number;
  /** Collision thickness: vertices keep this far off what they touch. Live. */
  radius?: number;
  /** 0 is inextensible. Stretch and shear share it: Jolt has one per segment. */
  stretchCompliance?: number;
  /**
   * How easily the rope bends and twists, one value for both, as in Jolt.
   * Lower is stiffer: about `1e-2` hangs like rope, `1e-5` holds like cable.
   */
  bendCompliance?: number;
  /** Vertex indices, or an end of every strand. Pinned vertices never move. */
  pinned?: RopePin;
  /**
   * A pinned end keeps the direction it was built with, as a cable held in
   * a fitting does. Off, it swings freely about the pin.
   */
  clamp?: boolean;
  /**
   * The authored shape is the rest shape, so a curled strand springs back to
   * its curl. Off, the rest shape is straight.
   */
  curl?: boolean;
  /** Spread over the free vertices. Default 1 per vertex. */
  mass?: number;
  /**
   * Tethers each free vertex to the nearest pin on either side, so the rope
   * cannot stretch past its length however hard it is pulled: `"geodesic"`
   * measures along the rope, `"euclidean"` straight across.
   */
  lra?: LRAType;
  lraMaxDistanceMultiplier?: number;
}

export interface RopeApi extends SoftBodyBaseApi {
  /** A vertex buffer and segment index the hook rewrites in place. */
  geometry: BufferGeometry;
  debugMesh: LineSegments | null;
  segmentCount: number;
  restLength: number;
  /** Along the rope, as of the last step. */
  length: () => number;
  /**
   * The material frame of a segment, as of the last step: its local +Z runs
   * along the segment, and +X turns with the rope's twist.
   */
  getRotation: (segment: number, target?: Quaternion) => Quaternion;
}

const DEFAULT_RADIUS = 0.02;
const DEFAULT_BEND_COMPLIANCE = 1e-2;
const DEFAULT_CURVE_SEGMENTS = 16;
const DEFAULT_AIR_DRAG = 1;

const strandOf = (options: UseRopeOptions) => {
  if (options.curve) {
    return strandFromCurve(
      options.curve,
      options.segments ?? DEFAULT_CURVE_SEGMENTS,
    );
  }
  if (options.points) return strandFromPoints(options.points, options.segments);
  throw new Error("[r3f-jolt] useRope: needs `points` or `curve`.");
};

const pinFlags = (strands: RodStrands, pinned: RopePin | undefined) => {
  const flags = new Uint8Array(strands.positions.length / 3);
  if (pinned === undefined) return flags;

  if (typeof pinned !== "string") {
    for (const index of pinned) {
      if (index >= 0 && index < flags.length) flags[index] = 1;
    }
    return flags;
  }

  for (let strand = 0; strand + 1 < strands.starts.length; strand += 1) {
    if (pinned !== "end") flags[strands.starts[strand]] = 1;
    if (pinned !== "start") flags[strands.starts[strand + 1] - 1] = 1;
  }
  return flags;
};

const createRopeGeometry = (topology: RodTopology) => {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(
    new Float32Array(topology.vertexCount * 3),
    3,
  );
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", position);

  const index: number[] = [];
  for (const start of topology.segmentStart) index.push(start, start + 1);
  geometry.setIndex(index);

  geometry.boundingBox = new Box3();
  geometry.boundingSphere = new Sphere();
  return geometry;
};

const writeGeometry = (
  geometry: BufferGeometry,
  local: Readonly<Float32Array>,
  bounds: Readonly<Box3>,
  radius: number,
) => {
  const position = geometry.getAttribute("position") as BufferAttribute;
  (position.array as Float32Array).set(local);
  position.needsUpdate = true;

  const box = geometry.boundingBox;
  const sphere = geometry.boundingSphere;
  if (box && sphere) {
    box.copy(bounds);
    box.getCenter(sphere.center);
    sphere.radius = box.min.distanceTo(box.max) / 2 + radius;
  }
};

const measureLength = (
  heap: Float32Array,
  handle: SoftBodyHandle,
  topology: RodTopology,
) => {
  const { stride, position } = handle.layout;
  let total = 0;
  for (const start of topology.segmentStart) {
    const a = position + start * stride;
    const b = a + stride;
    total += Math.hypot(
      heap[b] - heap[a],
      heap[b + 1] - heap[a + 1],
      heap[b + 2] - heap[a + 2],
    );
  }
  return total;
};

interface RopeInternals {
  handle: SoftBodyHandle;
  geometry: BufferGeometry;
}

/**
 * A Cosserat rod: each segment carries an orientation, so unlike a chain of
 * distance constraints a rope resists twisting and has a frame to draw along.
 */
export const useRope = (options: UseRopeOptions) => {
  const ref = useRef<Object3D | null>(null);
  const api = useJolt();
  const scene = useThree((state) => state.scene);
  const debugViewRef = useRef<DebugView<LineSegments> | null>(null);
  const [ropeApi, setRopeApi] = useState<RopeApi>();
  const air = useAir(options.wind, options.airDrag ?? DEFAULT_AIR_DRAG);
  const radius = options.radius ?? DEFAULT_RADIUS;
  const radiusRef = useRef(radius);

  // Creation is init-once, like every body: rebuild with `key`.
  const [mount] = useState(() => options);

  const internals = useRef<RopeInternals | null>(null);

  useEffect(() => {
    const jolt = api.Jolt;
    const options = mount;

    requireRoomForBody(api.physicsSystem);

    const strands = packStrands([strandOf(options)], "useRope");
    const { shared, topology } = createRodSettings(
      jolt,
      strands,
      {
        stretchCompliance: options.stretchCompliance ?? 0,
        bendCompliance: options.bendCompliance ?? DEFAULT_BEND_COMPLIANCE,
        pinned: pinFlags(strands, options.pinned),
        clamp: options.clamp ?? false,
        curl: options.curl ?? false,
        mass: options.mass,
        lra: options.lra ?? "none",
        lraMaxDistanceMultiplier: options.lraMaxDistanceMultiplier,
      },
      "useRope",
    );

    const handle = createSoftBodyHandle(api, {
      shared,
      position: options.position ?? [0, 0, 0],
      rotation: [0, 0, 0, 1],
      options: { ...options, vertexRadius: options.radius ?? DEFAULT_RADIUS },
      mass: options.mass,
      hook: "useRope",
    });
    const { motion, readable } = handle;
    const geometry = createRopeGeometry(topology);
    internals.current = { handle, geometry };

    const buildDebugLines = () => {
      const lines = new LineSegments(geometry, createDebugLineMaterial("rope"));
      lines.renderOrder = DEBUG_RENDER_ORDER;
      lines.frustumCulled = false;
      scene.add(lines);
      return lines;
    };

    const releaseDebugLines = (lines: LineSegments) => {
      scene.remove(lines);
      disposeDebugMaterial(lines);
    };

    const debugView = createDebugView(buildDebugLines, releaseDebugLines);
    debugViewRef.current = debugView;

    const published: Omit<RopeApi, "debugMesh"> = {
      ...createSoftBodyBaseApi(api, handle, air, (index) => index, options.mass),
      geometry,
      segmentCount: topology.segmentCount,
      restLength: topology.restLength.reduce((sum, length) => sum + length, 0),

      length: () =>
        readable() ? measureLength(jolt.HEAPF32, handle, topology) : 0,

      getRotation: (segment, target = new Quaternion()) => {
        const rod = topology.rodOf[segment];
        if (!readable() || rod === undefined) return target.identity();
        return readRodRotation(jolt, motion, rod, target);
      },
    };

    const result = published as RopeApi;
    Object.defineProperty(result, "debugMesh", {
      get: () => debugView.current,
      enumerable: true,
    });

    const unsubscribeAir = addAirPass(
      api,
      handle,
      air,
      function dragRope(heap, layout, wind, drag, delta) {
        dragSegments(heap, layout, topology, radiusRef.current * 2, wind, drag, delta);
      },
    );

    // The same external-resource publication as `useCar`: the body only exists
    // once this effect has built it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRopeApi(result);

    return () => {
      handle.retire();
      unsubscribeAir();
      setRopeApi(undefined);
      internals.current = null;

      debugView.hide();
      debugViewRef.current = null;
      geometry.dispose();

      handle.destroy();
    };
  }, [api, mount, scene, air]);

  useEffect(
    function trackRadius() {
      radiusRef.current = radius;
    },
    [radius],
  );

  useLiveSoftBodyOptions(api, ropeApi, { ...options, vertexRadius: radius });
  useWaterBody(ropeApi?.body, options);

  const debug = useDebugFlag(mount.debug);
  useDebugView(ropeApi, debugViewRef, debug);

  useFrame(function syncRope() {
    const inner = internals.current;
    if (!ropeApi || !inner || !inner.handle.usable()) return;

    const { handle, geometry } = inner;
    const { body, layout, tracker } = handle;
    const changed = body.IsActive()
      ? tracker.update(api.Jolt, body, layout, api.timing)
      : tracker.rest(api.Jolt, body, layout, api.timing);

    if (changed) writeGeometry(geometry, tracker.local, tracker.bounds, radius);

    ref.current?.position.copy(tracker.origin);
    ropeApi.debugMesh?.position.copy(tracker.origin);
  });

  return [ref, ropeApi] as [RefObject<Object3D | null>, RopeApi | undefined];
};
