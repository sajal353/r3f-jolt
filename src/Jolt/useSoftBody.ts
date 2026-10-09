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
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createSharedSettings,
  weldGeometry,
  type SoftBodyConstraintOptions,
  type SoftBodyTopology,
} from "./internal/softBodyBuild";
import {
  softBodyMotion,
  softBodyVertices,
  type SoftBodyVertices,
} from "./internal/softBodyVertices";
import { createVertexTracker } from "./internal/softBodyTracker";
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
import {
  useWaterBody,
  validateUserData,
  withCollisionGroup,
  type CollisionGroupOptions,
  type WaterBodyOptions,
} from "./internal/useBody";
import { readVector } from "./internal/query";
import type { QuatTuple, Vec3Input, Vec3Tuple } from "./types";

export type { BendType, LRAType } from "./internal/softBodyBuild";

export interface UseSoftBodyOptions
  extends SoftBodyConstraintOptions,
    WaterBodyOptions {
  position?: Vec3Tuple;
  /** Baked into the vertices: a soft body's own rotation stays identity. */
  rotation?: QuatTuple;
  /** Geometry vertices closer than this become one simulated vertex. */
  weld?: number;
  iterations?: number;
  linearDamping?: number;
  maxLinearVelocity?: number;
  restitution?: number;
  friction?: number;
  /** Pushes a closed mesh outwards: n·R·T, in pascal-cubic-metres. */
  pressure?: number;
  gravityFactor?: number;
  /**
   * Keeps the vertices this far off whatever they rest on, so cloth draped
   * over a mesh does not z-fight with it.
   */
  vertexRadius?: number;
  /** Collide with both sides of a face — a flag, rather than a balloon. */
  facesDoubleSided?: boolean;
  allowSleeping?: boolean;
  userData?: number;
  layer?: number;
  group?: number;
  mask?: number;
  collisionGroup?: CollisionGroupOptions;
  enabled?: boolean;
  debug?: boolean;
  /** World-space air velocity, pushing each face along its normal. Live. */
  wind?: Vec3Tuple;
  /**
   * Air resistance per square metre of face, against the body's motion through
   * the air (`wind` included). What makes cloth drift down and settle rather
   * than drop and swing like chain. 0 turns it off. Live.
   */
  airDrag?: number;
  /** Recompute normals when the vertices move. Off for unlit materials. */
  normals?: boolean;
  settingsOverride?: (
    shared: Jolt.SoftBodySharedSettings,
    creation: Jolt.SoftBodyCreationSettings,
  ) => void;
}

/**
 * Every vertex index here is a **geometry** vertex index — the one your
 * `BufferGeometry` uses — mapped through the weld, so a seam vertex and its
 * twin address the same simulated point.
 */
export interface SoftBodyApi {
  body: Jolt.Body;
  /** Your geometry, cloned, with positions and normals the hook rewrites. */
  geometry: BufferGeometry;
  debugMesh: Mesh | null;
  /** Simulated vertices, after welding. */
  vertexCount: number;
  setEnabled: (enabled: boolean) => void;
  /** Acts on the whole body, every vertex alike. */
  applyForce: (force: Vec3Input) => void;
  applyImpulse: (impulse: Vec3Input) => void;
  setLinearVelocity: (velocity: Vec3Input) => void;
  setPosition: (position: Vec3Input) => void;
  wake: () => void;
  sleep: () => void;
  isSleeping: () => boolean;
  /** World position of a geometry vertex, as of the last step. */
  getVertex: (index: number, target?: Vector3) => Vector3;
  /** Teleports a vertex, with no velocity. Pin it too, or it falls again. */
  setVertex: (index: number, position: Vec3Input) => void;
  /**
   * Sets one vertex moving, without pinning it. Called before every step with
   * a velocity towards a target, it drags cloth the way a hand does: the
   * vertex keeps its mass, so the cloth pulls back instead of being yanked.
   * A pinned vertex has no mass to keep: it moves at exactly this velocity
   * until it is set again.
   */
  setVertexVelocity: (index: number, velocity: Vec3Input) => void;
  /** A pinned vertex has no mass: constraints and gravity cannot move it. */
  isPinned: (index: number) => boolean;
  pin: (index: number, pinned: boolean) => void;
  setWind: (wind: Vec3Input) => void;
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

/** Pinned vertices are left alone: they move only when told to. */
const addToFreeVertices = (
  heap: Float32Array,
  layout: SoftBodyVertices,
  x: number,
  y: number,
  z: number,
  replace: boolean,
) => {
  for (let index = 0; index < layout.count; index += 1) {
    const offset = index * layout.stride;
    if (heap[layout.inverseMass + offset] <= 0) continue;
    const at = layout.velocity + offset;
    heap[at] = (replace ? 0 : heap[at]) + x;
    heap[at + 1] = (replace ? 0 : heap[at + 1]) + y;
    heap[at + 2] = (replace ? 0 : heap[at + 2]) + z;
  }
};

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

const ZERO: Vec3Tuple = [0, 0, 0];

/** Roughly ½ × air density × the drag coefficient of a flat sheet. */
const DEFAULT_AIR_DRAG = 1;

export const useSoftBody = (
  geometry: BufferGeometry,
  options: UseSoftBodyOptions = {},
) => {
  const ref = useRef<Mesh | null>(null);
  const api = useJolt();
  const scene = useThree((state) => state.scene);
  const debugViewRef = useRef<DebugView<Mesh> | null>(null);
  const [softApi, setSoftApi] = useState<SoftBodyApi>();
  const windRef = useRef(new Vector3());
  const airDragRef = useRef(DEFAULT_AIR_DRAG);

  // Creation is init-once, like every body: rebuild with `key`.
  const [mount] = useState(() => ({ geometry, options }));

  const internals = useRef<{
    layout: SoftBodyVertices;
    topology: SoftBodyTopology;
    tracker: ReturnType<typeof createVertexTracker>;
    motion: Jolt.SoftBodyMotionProperties;
    geometry: BufferGeometry;
    normals: Float32Array;
    usable: () => boolean;
  } | null>(null);

  useEffect(() => {
    const {
      Jolt: jolt,
      bodyInterface,
      physicsSystem,
      layers,
      groups,
      objectLayer,
      temps,
      state,
      steps,
    } = api;
    const { geometry: source, options } = mount;
    const {
      position = [0, 0, 0],
      rotation = [0, 0, 0, 1],
      weld = 1e-4,
      iterations,
      linearDamping,
      maxLinearVelocity,
      restitution,
      friction,
      pressure,
      gravityFactor,
      vertexRadius,
      facesDoubleSided,
      allowSleeping,
      userData,
      layer,
      group,
      mask,
      collisionGroup,
      enabled = true,
      settingsOverride,
    } = options;

    if (physicsSystem.GetNumBodies() >= physicsSystem.GetMaxBodies()) {
      throw new Error(
        `r3f-jolt: the world is full at ${physicsSystem.GetMaxBodies()} bodies. ` +
          "Raise `maxBodies` on <Physics>.",
      );
    }

    const topology = weldGeometry(source, weld);
    const shared = createSharedSettings(jolt, source, topology, options);

    const resolvedLayer =
      layer ??
      (group !== undefined || mask !== undefined
        ? objectLayer(
            group ?? groups.GROUP_MOVING,
            mask ?? groups.GROUP_MOVING | groups.GROUP_NON_MOVING,
          )
        : layers.LAYER_MOVING);

    const creation = new jolt.SoftBodyCreationSettings(
      shared,
      temps.rvec3(position),
      temps.quat(rotation),
      resolvedLayer,
    );

    if (iterations !== undefined) creation.mNumIterations = iterations;
    if (linearDamping !== undefined) creation.mLinearDamping = linearDamping;
    if (maxLinearVelocity !== undefined) {
      creation.mMaxLinearVelocity = maxLinearVelocity;
    }
    if (restitution !== undefined) creation.mRestitution = restitution;
    if (friction !== undefined) creation.mFriction = friction;
    if (pressure !== undefined) creation.mPressure = pressure;
    if (gravityFactor !== undefined) creation.mGravityFactor = gravityFactor;
    if (vertexRadius !== undefined) creation.mVertexRadius = vertexRadius;
    if (facesDoubleSided !== undefined) {
      creation.mFacesDoubleSided = facesDoubleSided;
    }
    if (allowSleeping !== undefined) creation.mAllowSleeping = allowSleeping;
    if (userData !== undefined) {
      validateUserData(userData, "userData");
      creation.mUserData = userData;
    }
    if (collisionGroup) {
      withCollisionGroup(jolt, collisionGroup, (value) => {
        creation.mCollisionGroup = value;
      });
    }

    settingsOverride?.(shared, creation);

    const body = bodyInterface.CreateSoftBody(creation);
    jolt.destroy(creation);
    // The body holds its own reference now.
    shared.Release();

    const id = body.GetID();
    const bodyID = id.GetIndexAndSequenceNumber();
    const layout = softBodyVertices(jolt, body);
    const motion = softBodyMotion(jolt, body);
    const softShape = jolt.castObject(body.GetShape(), jolt.SoftBodyShape);
    const subShape = new jolt.SubShapeID();
    const faceBits = softShape.GetSubShapeIDBits();
    // Jolt fills the bits a sub-shape ID does not use with ones. An ID with
    // anything else up there came from another body, and decoding it asserts.
    const unusedBits = 0xffffffff >>> faceBits;
    const restInverseMass = new Float32Array(layout.count);
    for (let index = 0; index < layout.count; index += 1) {
      restInverseMass[index] =
        jolt.HEAPF32[layout.inverseMass + index * layout.stride];
    }
    const freeInverseMass =
      restInverseMass.find((value) => value > 0) ??
      (options.mass ? layout.count / options.mass : 1);

    const renderGeometry = cloneForRender(source);
    const tracker = createVertexTracker(layout.count);

    let added = false;
    let alive = true;
    const usable = () => added && alive && !state.disposed;

    const setEnabled = (value: boolean) => {
      if (!alive || state.disposed || value === added) return;
      if (value) {
        bodyInterface.AddBody(id, jolt.EActivation_Activate);
      } else {
        api.contacts.forgetSoftBody(bodyID);
        bodyInterface.RemoveBody(id);
      }
      added = value;
    };

    setEnabled(enabled);

    internals.current = {
      layout,
      topology,
      tracker,
      motion,
      geometry: renderGeometry,
      normals: new Float32Array(layout.count * 3),
      usable,
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

    const vertexAt = (index: number) =>
      layout.position + topology.vertexOf[index] * layout.stride;

    const published: Omit<SoftBodyApi, "debugMesh"> = {
      body,
      geometry: renderGeometry,
      vertexCount: layout.count,
      setEnabled,

      applyForce: (force) => {
        if (!usable()) return;
        bodyInterface.AddForce(id, temps.vec3(force), jolt.EActivation_Activate);
      },

      // Jolt's own `AddImpulse` and `SetLinearVelocity` write the rigid-body
      // velocity, which a soft body's solver never reads; these go to the
      // vertices instead.
      applyImpulse: (impulse) => {
        if (!usable()) return;
        const heap = jolt.HEAPF32;
        let mass = 0;
        for (let index = 0; index < layout.count; index += 1) {
          const inverse = heap[layout.inverseMass + index * layout.stride];
          if (inverse > 0) mass += 1 / inverse;
        }
        if (mass === 0) return;
        const [x, y, z] = readVector(impulse);
        addToFreeVertices(heap, layout, x / mass, y / mass, z / mass, false);
        bodyInterface.ActivateBody(id);
      },

      setLinearVelocity: (velocity) => {
        if (!usable()) return;
        const [x, y, z] = readVector(velocity);
        addToFreeVertices(jolt.HEAPF32, layout, x, y, z, true);
        bodyInterface.ActivateBody(id);
      },

      setPosition: (target) => {
        if (!usable()) return;
        tracker.reset();
        bodyInterface.SetPositionAndRotation(
          id,
          temps.rvec3(target),
          temps.quat([0, 0, 0, 1]),
          jolt.EActivation_Activate,
        );
      },

      wake: () => {
        if (usable()) bodyInterface.ActivateBody(id);
      },

      sleep: () => {
        if (usable()) bodyInterface.DeactivateBody(id);
      },

      isSleeping: () => usable() && !bodyInterface.IsActive(id),

      getVertex: (index, target = new Vector3()) => {
        if (!alive || state.disposed) return target.set(0, 0, 0);
        const at = vertexAt(index);
        const origin = body.GetPosition();
        const heap = jolt.HEAPF32;
        return target.set(
          heap[at] + origin.GetX(),
          heap[at + 1] + origin.GetY(),
          heap[at + 2] + origin.GetZ(),
        );
      },

      setVertex: (index, target) => {
        if (!usable()) return;
        const [x, y, z] = readVector(target);
        const physics = topology.vertexOf[index];
        const at = layout.position + physics * layout.stride;
        const velocity = layout.velocity + physics * layout.stride;
        const origin = body.GetPosition();
        const heap = jolt.HEAPF32;
        heap[at] = x - origin.GetX();
        heap[at + 1] = y - origin.GetY();
        heap[at + 2] = z - origin.GetZ();
        heap.set(ZERO, velocity);
        bodyInterface.ActivateBody(id);
      },

      setVertexVelocity: (index, velocity) => {
        if (!usable()) return;
        const at = layout.velocity + topology.vertexOf[index] * layout.stride;
        const [x, y, z] = readVector(velocity);
        const heap = jolt.HEAPF32;
        heap[at] = x;
        heap[at + 1] = y;
        heap[at + 2] = z;
        if (!bodyInterface.IsActive(id)) bodyInterface.ActivateBody(id);
      },

      isPinned: (index) =>
        alive &&
        !state.disposed &&
        jolt.HEAPF32[
          layout.inverseMass + topology.vertexOf[index] * layout.stride
        ] === 0,

      pin: (index, pinned) => {
        if (!usable()) return;
        const physics = topology.vertexOf[index];
        const heap = jolt.HEAPF32;
        heap[layout.inverseMass + physics * layout.stride] = pinned
          ? 0
          : restInverseMass[physics] || freeInverseMass;
        heap.set(ZERO, layout.velocity + physics * layout.stride);
        bodyInterface.ActivateBody(id);
      },

      setWind: (wind) => {
        const [x, y, z] = readVector(wind);
        windRef.current.set(x, y, z);
      },

      faceOf: (subShapeID) => {
        if (!alive || state.disposed) return -1;
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

    const unsubscribeWind = steps.add("before", function blowOnSoftBody(delta) {
      const wind = windRef.current;
      const drag = airDragRef.current;
      if (!usable() || drag <= 0) return;

      // Still air leaves a sleeper asleep; wind wakes it.
      if (!bodyInterface.IsActive(id)) {
        if (wind.lengthSq() === 0) return;
        bodyInterface.ActivateBody(id);
      }
      blowWind(jolt.HEAPF32, layout, wind, drag, delta);
    });

    setSoftApi(result);

    return () => {
      alive = false;
      unsubscribeWind();
      setSoftApi(undefined);
      internals.current = null;

      debugView.hide();
      debugViewRef.current = null;
      renderGeometry.dispose();

      if (state.destroyed) return;

      jolt.destroy(subShape);
      if (added) {
        api.contacts.forgetSoftBody(bodyID);
        bodyInterface.RemoveBody(id);
      }
      bodyInterface.DestroyBody(id);
    };
  }, [api, mount, scene]);

  const {
    pressure,
    iterations,
    vertexRadius,
    friction,
    restitution,
    gravityFactor,
    linearDamping,
    wind,
    airDrag = DEFAULT_AIR_DRAG,
  } = options;

  const appliedRef = useRef(false);

  useEffect(
    function applyLiveOptions() {
      const motion = internals.current?.motion;
      if (!softApi || !motion) return;

      if (pressure !== undefined) motion.SetPressure(pressure);
      if (iterations !== undefined) motion.SetNumIterations(iterations);
      if (vertexRadius !== undefined) motion.SetVertexRadius(vertexRadius);
      if (gravityFactor !== undefined) motion.SetGravityFactor(gravityFactor);
      if (linearDamping !== undefined) motion.SetLinearDamping(linearDamping);
      if (friction !== undefined) softApi.body.SetFriction(friction);
      if (restitution !== undefined) softApi.body.SetRestitution(restitution);

      // The first pass only restates what creation already set.
      if (appliedRef.current) softApi.wake();
      appliedRef.current = true;
    },
    [
      softApi,
      pressure,
      iterations,
      vertexRadius,
      friction,
      restitution,
      gravityFactor,
      linearDamping,
    ],
  );

  const [windX, windY, windZ] = wind ?? ZERO;

  useEffect(
    function applyAir() {
      windRef.current.set(windX, windY, windZ);
      airDragRef.current = airDrag;
    },
    [windX, windY, windZ, airDrag],
  );

  useWaterBody(softApi?.body, options);

  const debug = useDebugFlag(mount.options.debug);
  useDebugView(softApi, debugViewRef, debug);

  const wantsNormals = options.normals !== false;

  useFrame(function syncSoftBody() {
    const inner = internals.current;
    if (!softApi || !inner || !inner.usable()) return;

    const { layout, topology, tracker, normals, geometry: target } = inner;
    const body = softApi.body;

    const changed = body.IsActive()
      ? tracker.update(api.Jolt, body, layout, api.timing)
      : tracker.rest(api.Jolt, body, layout);

    if (changed) {
      writeRender(
        topology,
        tracker.local,
        target.getAttribute("position") as BufferAttribute,
      );

      if (wantsNormals) {
        computeNormals(topology.faces, tracker.local, normals);
        writeRender(
          topology,
          normals,
          target.getAttribute("normal") as BufferAttribute,
        );
      }

      const box = target.boundingBox;
      const sphere = target.boundingSphere;
      if (box && sphere) {
        box.copy(tracker.bounds);
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
