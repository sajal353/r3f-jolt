import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  DynamicDrawUsage,
  Mesh,
  Sphere,
  Box3,
  Vector3,
  type BufferGeometry,
} from "three";
import { useJolt } from "./useJolt";
import {
  createSharedSettings,
  weldGeometry,
  type SoftBodyConstraintOptions,
  type SoftBodyTopology,
} from "./internal/softBodyBuild";
import type { SoftBodyVertices } from "./internal/softBodyVertices";
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
import {
  bindSkin,
  createSkinDriver,
  type SkinDriver,
  type SoftBodySkinOptions,
} from "./internal/softBodySkin";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./internal/debugView";
import {
  createDebugMaterial,
  disposeDebugMaterial,
  DEBUG_RENDER_ORDER,
} from "./internal/debugMaterial";
import { useWaterBody } from "./internal/useBody";
import type { QuatTuple } from "./types";

export type { BendType, LRAType } from "./internal/softBodyBuild";
export type { SoftBodySkinOptions } from "./internal/softBodySkin";

export interface UseSoftBodyOptions
  extends SoftBodyConstraintOptions,
    SoftBodyBodyOptions {
  /** Baked into the vertices: a soft body's own rotation stays identity. */
  rotation?: QuatTuple;
  /** Geometry vertices closer than this become one simulated vertex. */
  weld?: number;
  /** Pushes a closed mesh outwards: n·R·T, in pascal-cubic-metres. */
  pressure?: number;
  /** Collide with both sides of a face — a flag, rather than a balloon. */
  facesDoubleSided?: boolean;
  /**
   * Air resistance per square metre of face, against the body's motion through
   * the air (`wind` included). What makes cloth drift down and settle rather
   * than drop and swing like chain. 0 turns it off. Live.
   */
  airDrag?: number;
  /** Recompute normals when the vertices move. Off for unlit materials. */
  normals?: boolean;
  /**
   * Skins the cloth to a character: placed from the mesh, so `position` and
   * `rotation` are ignored. Call the hook after whatever moves the bones — a
   * mixer, `useRagdoll` — so it draws on this frame's pose.
   */
  skin?: SoftBodySkinOptions;
  /** Off, only the vertices held to the skin follow it. Default on. Live. */
  skinConstraints?: boolean;
  /** Scales every `skin.maxDistance`. Default 1. Live. */
  skinnedMaxDistanceMultiplier?: number;
}

/**
 * Every vertex index here is a **geometry** vertex index — the one your
 * `BufferGeometry` uses — mapped through the weld, so a seam vertex and its
 * twin address the same simulated point.
 */
export interface SoftBodyApi extends SoftBodyBaseApi {
  /** Your geometry, cloned, with positions and normals the hook rewrites. */
  geometry: BufferGeometry;
  debugMesh: Mesh | null;
  /**
   * Puts every vertex back on the skin, at rest, on the next step: after
   * teleporting the character. Does nothing without `skin`.
   */
  snapToSkin: () => void;
  /**
   * The geometry triangle a ray hit, from its `subShapeID`; -1 for an ID that
   * did not come from this body.
   */
  faceOf: (subShapeID: number) => number;
}

const writeRender = (
  topology: SoftBodyTopology,
  source: Readonly<Float32Array>,
  target: BufferAttribute,
) => {
  const array = target.array as Float32Array;
  const { vertexOf } = topology;

  for (let index = 0; index < vertexOf.length; index += 1) {
    const from = vertexOf[index] * 3;
    array[index * 3] = source[from];
    array[index * 3 + 1] = source[from + 1];
    array[index * 3 + 2] = source[from + 2];
  }

  target.needsUpdate = true;
};

const addTo = (
  target: Float32Array,
  at: number,
  x: number,
  y: number,
  z: number,
) => {
  target[at] += x;
  target[at + 1] += y;
  target[at + 2] += z;
};

/** Area-weighted, on the welded mesh, so seams shade smoothly. */
const computeNormals = (
  faces: Uint32Array,
  positions: Readonly<Float32Array>,
  normals: Float32Array,
) => {
  normals.fill(0);

  for (let face = 0; face < faces.length; face += 3) {
    const a = faces[face] * 3;
    const b = faces[face + 1] * 3;
    const c = faces[face + 2] * 3;

    const abX = positions[b] - positions[a];
    const abY = positions[b + 1] - positions[a + 1];
    const abZ = positions[b + 2] - positions[a + 2];
    const acX = positions[c] - positions[a];
    const acY = positions[c + 1] - positions[a + 1];
    const acZ = positions[c + 2] - positions[a + 2];

    const x = abY * acZ - abZ * acY;
    const y = abZ * acX - abX * acZ;
    const z = abX * acY - abY * acX;

    addTo(normals, a, x, y, z);
    addTo(normals, b, x, y, z);
    addTo(normals, c, x, y, z);
  }

  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(
      normals[index],
      normals[index + 1],
      normals[index + 2],
    );
    if (length > 0) {
      normals[index] /= length;
      normals[index + 1] /= length;
      normals[index + 2] /= length;
    }
  }
};

const cloneForRender = (source: BufferGeometry) => {
  const geometry = source.clone();
  const position = geometry.getAttribute("position") as BufferAttribute;
  position.setUsage(DynamicDrawUsage);

  const normal = new BufferAttribute(new Float32Array(position.count * 3), 3);
  normal.setUsage(DynamicDrawUsage);
  geometry.setAttribute("normal", normal);
  geometry.boundingBox = new Box3();
  geometry.boundingSphere = new Sphere();

  return geometry;
};

/**
 * Pushes a vertex along the face normal `n` by `scale × n` per unit mass — a
 * pinned vertex has none and stays put — but never by more than this face's
 * share of `cancel × n`, which would stop the vertex's motion through the air
 * outright. Drag applied explicitly overshoots on a light, fast cloth, and
 * every overshoot reverses the vertex harder than the last; capping each face
 * at its share keeps the six or so faces round a vertex from adding up past it.
 */
const pushVertex = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  vertex: number,
  normal: Vector3,
  scale: number,
  cancel: number,
) => {
  const offset = vertex * layout.stride;
  const inverseMass = heap[layout.inverseMass + offset];
  if (inverseMass <= 0) return;
  const limit = cancel * layout.faceShare[vertex];
  const push =
    scale >= 0
      ? Math.min(scale * inverseMass, limit)
      : Math.max(scale * inverseMass, limit);
  const at = layout.velocity + offset;
  heap[at] += normal.x * push;
  heap[at + 1] += normal.y * push;
  heap[at + 2] += normal.z * push;
};

const faceNormal = new Vector3();

/**
 * Air resistance on every face, as a velocity change on its free vertices,
 * before each step. Faces see the air relative to their own motion, so a flag moving
 * with the wind stops being pushed, and the push grows with the square of the
 * speed, as drag does.
 */
const blowWind = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  wind: Vector3,
  drag: number,
  delta: number,
) => {
  const { faces, stride, position, velocity } = layout;

  for (let face = 0; face < faces.length; face += 3) {
    const a = faces[face] * stride;
    const b = faces[face + 1] * stride;
    const c = faces[face + 2] * stride;

    const abX = heap[position + b] - heap[position + a];
    const abY = heap[position + b + 1] - heap[position + a + 1];
    const abZ = heap[position + b + 2] - heap[position + a + 2];
    const acX = heap[position + c] - heap[position + a];
    const acY = heap[position + c + 1] - heap[position + a + 1];
    const acZ = heap[position + c + 2] - heap[position + a + 2];

    const nX = abY * acZ - abZ * acY;
    const nY = abZ * acX - abX * acZ;
    const nZ = abX * acY - abY * acX;
    const twiceArea = Math.hypot(nX, nY, nZ);
    if (twiceArea < 1e-12) continue;

    const airX =
      wind.x -
      (heap[velocity + a] + heap[velocity + b] + heap[velocity + c]) / 3;
    const airY =
      wind.y -
      (heap[velocity + a + 1] +
        heap[velocity + b + 1] +
        heap[velocity + c + 1]) /
        3;
    const airZ =
      wind.z -
      (heap[velocity + a + 2] +
        heap[velocity + b + 2] +
        heap[velocity + c + 2]) /
        3;

    const speed = Math.hypot(airX, airY, airZ);
    const along = nX * airX + nY * airY + nZ * airZ;
    // drag × area × (n̂·air) × |air|, along n̂, a third to each corner.
    const scale = (drag * along * speed * delta) / (2 * twiceArea * 3);

    const cancel = along / (twiceArea * twiceArea);
    faceNormal.set(nX, nY, nZ);

    pushVertex(heap, layout, faces[face], faceNormal, scale, cancel);
    pushVertex(heap, layout, faces[face + 1], faceNormal, scale, cancel);
    pushVertex(heap, layout, faces[face + 2], faceNormal, scale, cancel);
  }
};

const boundsPoint = new Vector3();

const boundsOf = (positions: Float32Array, target: Box3) => {
  target.makeEmpty();
  for (let index = 0; index < positions.length; index += 3) {
    target.expandByPoint(
      boundsPoint.set(positions[index], positions[index + 1], positions[index + 2]),
    );
  }
  return target;
};

/** Roughly ½ × air density × the drag coefficient of a flat sheet. */
const DEFAULT_AIR_DRAG = 1;

interface SoftBodyInternals {
  handle: SoftBodyHandle;
  topology: SoftBodyTopology;
  geometry: BufferGeometry;
  normals: Float32Array;
  skin: SkinDriver | null;
  /** The tracker's vertices moved onto the live skin. */
  drawn: Float32Array;
}

export const useSoftBody = (
  geometry: BufferGeometry,
  options: UseSoftBodyOptions = {},
) => {
  const ref = useRef<Mesh | null>(null);
  const api = useJolt();
  const scene = useThree((state) => state.scene);
  const debugViewRef = useRef<DebugView<Mesh> | null>(null);
  const [softApi, setSoftApi] = useState<SoftBodyApi>();
  const air = useAir(options.wind, options.airDrag ?? DEFAULT_AIR_DRAG);

  // Creation is init-once, like every body: rebuild with `key`.
  const [mount] = useState(() => ({ geometry, options }));

  const internals = useRef<SoftBodyInternals | null>(null);

  useEffect(() => {
    const { Jolt: jolt, state, steps } = api;
    const { geometry: source, options } = mount;
    const { weld = 1e-4, pressure, facesDoubleSided } = options;

    requireRoomForBody(api.physicsSystem);

    const topology = weldGeometry(source, weld);
    const binding = options.skin
      ? bindSkin(source, topology, options.skin)
      : undefined;
    const shared = createSharedSettings(
      jolt,
      source,
      topology,
      options,
      binding,
    );

    const handle = createSoftBodyHandle(api, {
      shared,
      position: binding
        ? [binding.origin.x, binding.origin.y, binding.origin.z]
        : (options.position ?? [0, 0, 0]),
      rotation: binding ? [0, 0, 0, 1] : (options.rotation ?? [0, 0, 0, 1]),
      options,
      mass: options.mass,
      hook: "useSoftBody",
      configure: function setClothFields(creation) {
        if (pressure !== undefined) creation.mPressure = pressure;
        if (facesDoubleSided !== undefined) {
          creation.mFacesDoubleSided = facesDoubleSided;
        }
      },
    });
    const { body, layout, motion, tracker, usable, readable } = handle;

    const softShape = jolt.castObject(body.GetShape(), jolt.SoftBodyShape);
    const subShape = new jolt.SubShapeID();
    const faceBits = softShape.GetSubShapeIDBits();
    // Jolt fills the bits a sub-shape ID does not use with ones. An ID with
    // anything else up there came from another body, and decoding it asserts.
    const unusedBits = 0xffffffff >>> faceBits;

    const renderGeometry = cloneForRender(source);
    const skin = binding
      ? createSkinDriver(jolt, binding, topology.positions)
      : null;

    internals.current = {
      handle,
      topology,
      geometry: renderGeometry,
      normals: new Float32Array(layout.count * 3),
      skin,
      drawn: new Float32Array(skin ? layout.count * 3 : 0),
    };

    const buildDebugMesh = () => {
      const mesh = new Mesh(renderGeometry, createDebugMaterial("softBody"));
      mesh.renderOrder = DEBUG_RENDER_ORDER;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };

    const releaseDebugMesh = (mesh: Mesh) => {
      scene.remove(mesh);
      disposeDebugMaterial(mesh);
    };

    const debugView = createDebugView(buildDebugMesh, releaseDebugMesh);
    debugViewRef.current = debugView;

    const published: Omit<SoftBodyApi, "debugMesh"> = {
      ...createSoftBodyBaseApi(
        api,
        handle,
        air,
        (index) => topology.vertexOf[index],
        options.mass,
      ),
      geometry: renderGeometry,

      snapToSkin: () => {
        skin?.snap();
      },

      faceOf: (subShapeID) => {
        if (!readable()) return -1;
        if (subShapeID >>> faceBits !== unusedBits) return -1;
        subShape.SetValue(subShapeID);
        const face = softShape.GetFaceIndex(subShape);
        return topology.triangleOf[face] ?? -1;
      },
    };

    const result = published as SoftBodyApi;
    Object.defineProperty(result, "debugMesh", {
      get: () => debugView.current,
      enumerable: true,
    });

    const unsubscribeWind = addAirPass(api, handle, air, blowWind);

    const tempAllocator = api.joltInterface.GetTempAllocator();
    const unsubscribeSkin = skin
      ? steps.add("before", function skinSoftBody() {
          if (!usable()) return;
          const { moved, hard } = skin.skin(body, motion, tempAllocator);
          // Jolt leaves a sleeping cloth where it lay as the bones walk off.
          if (moved && !api.bodyInterface.IsActive(handle.id)) {
            api.bodyInterface.ActivateBody(handle.id);
          }
          if (hard) tracker.reset();
        })
      : null;

    // The same external-resource publication as `useCar`: the body only exists
    // once this effect has built it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoftApi(result);

    return () => {
      handle.retire();
      unsubscribeWind();
      unsubscribeSkin?.();
      setSoftApi(undefined);
      internals.current = null;

      debugView.hide();
      debugViewRef.current = null;
      renderGeometry.dispose();

      if (state.destroyed) return;

      jolt.destroy(subShape);
      skin?.dispose();
      handle.destroy();
    };
  }, [api, mount, scene, air]);

  const {
    pressure,
    vertexRadius,
    skinConstraints,
    skinnedMaxDistanceMultiplier,
  } = options;

  useLiveSoftBodyOptions(api, softApi, options);

  const clothAppliedRef = useRef(false);

  useEffect(
    function applyLiveClothOptions() {
      if (!softApi) return;
      const motion = internals.current?.handle.motion;
      if (!motion) return;

      if (pressure !== undefined) motion.SetPressure(pressure);
      if (skinConstraints !== undefined) {
        motion.SetEnableSkinConstraints(skinConstraints);
      }
      if (skinnedMaxDistanceMultiplier !== undefined) {
        motion.SetSkinnedMaxDistanceMultiplier(skinnedMaxDistanceMultiplier);
      }

      if (clothAppliedRef.current) softApi.wake();
      clothAppliedRef.current = true;
    },
    [softApi, pressure, skinConstraints, skinnedMaxDistanceMultiplier],
  );

  useWaterBody(softApi?.body, options);

  const debug = useDebugFlag(mount.options.debug);
  useDebugView(softApi, debugViewRef, debug);

  const wantsNormals = options.normals !== false;
  const [skinBounds] = useState(() => new Box3());

  useFrame(function syncSoftBody() {
    const inner = internals.current;
    if (!softApi || !inner || !inner.handle.usable()) return;

    const { handle, topology, normals, skin, drawn, geometry: target } = inner;
    const { body, layout, tracker } = handle;
    const active = body.IsActive();
    const timing = api.timing;

    let changed = active
      ? tracker.update(api.Jolt, body, layout, timing)
      : tracker.rest(api.Jolt, body, layout, timing);

    let positions = tracker.local;
    let bounds = tracker.bounds;
    if (skin) {
      const alpha = active && timing.interpolate ? timing.alpha : 1;
      if (skin.correct(tracker.local, drawn, alpha, timing.stepCount)) {
        changed = true;
      }
      positions = drawn;
      bounds = boundsOf(drawn, skinBounds);
    }

    if (changed) {
      writeRender(
        topology,
        positions,
        target.getAttribute("position") as BufferAttribute,
      );

      if (wantsNormals) {
        computeNormals(topology.faces, positions, normals);
        writeRender(
          topology,
          normals,
          target.getAttribute("normal") as BufferAttribute,
        );
      }

      const box = target.boundingBox;
      const sphere = target.boundingSphere;
      if (box && sphere) {
        box.copy(bounds);
        box.getCenter(sphere.center);
        sphere.radius =
          box.min.distanceTo(box.max) / 2 + (vertexRadius ?? 0);
      }
    }

    const origin = tracker.origin;
    if (ref.current) {
      ref.current.position.copy(origin);
      ref.current.quaternion.identity();
    }
    softApi.debugMesh?.position.copy(origin);
  });

  return [ref, softApi] as [RefObject<Mesh | null>, SoftBodyApi | undefined];
};
