import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import { softBodyVertices, type SoftBodyVertices } from "./softBodyVertices";
import type {
  JoltModule,
  PhysicsTiming,
  StepRegistry,
  Vec3Input,
  WaterBodySettings,
  WaterEvent,
  WaterEventHandler,
  WaterRegistry,
  WaterSample,
  WaterVolumeEntry,
} from "../types";

/** Step across which a wave's slope is measured, in metres. */
const SLOPE_STEP = 0.1;

/**
 * A soft-body vertex is a point with no volume of its own, so its lift ramps up
 * over this depth instead of switching on at the surface, which would make it
 * chatter there.
 */
const SOFT_SURFACE_BAND = 0.1;

interface Tracked {
  volume: WaterVolumeEntry;
  userData: number;
  canFloat: boolean;
  /** Set for a soft body, which floats per vertex. */
  soft: SoftBodyVertices | null;
  seenAt: number;
}

interface Pending {
  handler: "volume" | "body";
  kind: "enter" | "exit";
  bodyID: number;
  volume: WaterVolumeEntry | null;
  event: WaterEvent;
}

interface LayerFilters {
  broadPhase: Jolt.BroadPhaseLayerFilter;
  object: Jolt.ObjectLayerFilter;
}

const byPriority = (a: WaterVolumeEntry, b: WaterVolumeEntry) =>
  b.priority - a.priority;

/**
 * Buoyancy for every `<WaterVolume>`, applied before each physics step so a
 * body bobs the same at any frame rate.
 *
 * Volumes run highest priority first and a body belongs to the first that
 * finds it, so overlapping water never pushes twice. A broadphase query per
 * volume finds the bodies; only the awake, dynamic ones are pushed, which lets
 * a settled float fall asleep. Sleepers still count as in the water, so falling
 * asleep is not leaving it.
 */
export const createWaterRegistry = (
  jolt: JoltModule,
  joltInterface: Jolt.JoltInterface,
  steps: StepRegistry,
  timing: PhysicsTiming,
): WaterRegistry => {
  const physicsSystem = joltInterface.GetPhysicsSystem();
  const bodyInterface = physicsSystem.GetBodyInterfaceNoLock();
  const lock = physicsSystem.GetBodyLockInterfaceNoLock();
  const broadPhase = physicsSystem.GetBroadPhaseQuery();

  const volumes: WaterVolumeEntry[] = [];
  const bodies = new Map<number, { readonly current: WaterBodySettings }>();
  const tracked = new Map<number, Tracked>();
  const pending: Pending[] = [];
  const filters = new Map<number, LayerFilters>();
  // Jolt has no volume for these, so asking one to float asserts.
  const noVolume = new Set<number>([
    jolt.EShapeType_Mesh,
    jolt.EShapeType_HeightField,
    jolt.EShapeType_Plane,
    jolt.EShapeType_Empty,
  ]);

  const surface = new jolt.RVec3(0, 0, 0);
  const up = new jolt.Vec3(0, 1, 0);
  const flow = new jolt.Vec3(0, 0, 0);
  const gravity = new jolt.Vec3(0, 0, 0);
  const corner = new jolt.Vec3(0, 0, 0);
  const box = new jolt.AABox();

  let current: WaterVolumeEntry | null = null;
  let delta = 0;
  let time = 0;
  let stepIndex = 0;
  let unsubscribe: (() => void) | null = null;
  let destroyed = false;

  const filtersFor = (layer: number) => {
    let entry = filters.get(layer);
    if (!entry) {
      entry = {
        broadPhase: new jolt.DefaultBroadPhaseLayerFilter(
          joltInterface.GetObjectVsBroadPhaseLayerFilter(),
          layer,
        ),
        object: new jolt.DefaultObjectLayerFilter(
          joltInterface.GetObjectLayerPairFilter(),
          layer,
        ),
      };
      filters.set(layer, entry);
    }
    return entry;
  };

  const innermost = (shape: Jolt.Shape) => {
    let inner = shape;
    while (inner.GetType() === jolt.EShapeType_Decorated) {
      inner = jolt.castObject(inner, jolt.DecoratedShape).GetInnerShape();
    }
    return inner;
  };

  const readEvent = (body: Jolt.Body, bodyID: number): WaterEvent => {
    const position = body.GetPosition();
    const velocity = body.GetLinearVelocity();
    return {
      bodyID,
      userData: Number(body.GetUserData()),
      position: new Vector3(position.GetX(), position.GetY(), position.GetZ()),
      velocity: new Vector3(velocity.GetX(), velocity.GetY(), velocity.GetZ()),
    };
  };

  /** `wet` marks a crossing between dry and wet, which the body hears about. */
  const queue = (
    kind: Pending["kind"],
    bodyID: number,
    volume: WaterVolumeEntry | null,
    event: WaterEvent,
    wet: boolean,
  ) => {
    if (volume) pending.push({ handler: "volume", kind, bodyID, volume, event });
    if (wet) pending.push({ handler: "body", kind, bodyID, volume, event });
  };

  /**
   * Whether a body dips below the wave under it, and if so, that wave's plane
   * for its buoyancy: the height there, tilted to the local slope.
   */
  const underWave = (
    body: Jolt.Body,
    volume: WaterVolumeEntry,
    waves: NonNullable<WaterVolumeEntry["waves"]>,
  ) => {
    const position = body.GetPosition();
    const x = position.GetX();
    const z = position.GetZ();
    const height = waves(x, z, time);
    const level = volume.surfaceLevel + height;

    if (body.GetWorldSpaceBounds().mMin.GetY() >= level) return false;

    const slopeX = (waves(x + SLOPE_STEP, z, time) - height) / SLOPE_STEP;
    const slopeZ = (waves(x, z + SLOPE_STEP, time) - height) / SLOPE_STEP;
    const length = Math.hypot(slopeX, 1, slopeZ);
    surface.Set(x, level, z);
    up.Set(-slopeX / length, 1 / length, -slopeZ / length);
    return true;
  };

  /**
   * `ApplyBuoyancyImpulse` asserts on a soft body, which has no rigid volume.
   * Each submerged vertex is lifted against gravity and dragged towards the
   * flow instead, straight on the heap.
   */
  const floatVertices = (
    body: Jolt.Body,
    layout: SoftBodyVertices,
    volume: WaterVolumeEntry,
    strength: number,
  ) => {
    const heap = jolt.HEAPF32;
    const origin = body.GetPosition();
    const originX = origin.GetX();
    const originY = origin.GetY();
    const originZ = origin.GetZ();
    const liftX = -gravity.GetX() * strength * delta;
    const liftY = -gravity.GetY() * strength * delta;
    const liftZ = -gravity.GetZ() * strength * delta;
    const drag = Math.min(1, volume.linearDrag * delta);
    const { min, max } = volume;

    for (let index = 0; index < layout.count; index += 1) {
      const offset = index * layout.stride;
      if (heap[layout.inverseMass + offset] <= 0) continue;

      const at = layout.position + offset;
      const x = heap[at] + originX;
      const y = heap[at + 1] + originY;
      const z = heap[at + 2] + originZ;
      if (x < min.x || x > max.x || z < min.z || z > max.z || y < min.y) {
        continue;
      }

      const level =
        volume.surfaceLevel + (volume.waves ? volume.waves(x, z, time) : 0);
      const depth = level - y;
      if (depth <= 0) continue;

      const share = Math.min(depth / SOFT_SURFACE_BAND, 1);
      const velocity = layout.velocity + offset;
      heap[velocity] += liftX * share + (volume.flow.x - heap[velocity]) * drag * share;
      heap[velocity + 1] +=
        liftY * share + (volume.flow.y - heap[velocity + 1]) * drag * share;
      heap[velocity + 2] +=
        liftZ * share + (volume.flow.z - heap[velocity + 2]) * drag * share;
    }
  };

  const collector = new jolt.CollideShapeBodyCollectorJS();
  collector.Reset = () => collector.ResetEarlyOutFraction();
  collector.AddHit = function found(pointer: number) {
    const volume = current;
    if (!volume) return;

    const id = jolt.wrapPointer(pointer, jolt.BodyID);
    const bodyID = id.GetIndexAndSequenceNumber();
    const record = tracked.get(bodyID);

    // Already claimed this step by a volume of higher priority.
    if (record && record.seenAt === stepIndex) return;

    const body = lock.TryGetBody(id);
    if (body.IsSensor()) return;
    if (volume.waves && !underWave(body, volume, volume.waves)) return;

    let entry = record;

    if (!entry) {
      entry = {
        volume,
        userData: Number(body.GetUserData()),
        canFloat:
          body.IsSoftBody() ||
          !noVolume.has(innermost(body.GetShape()).GetType()),
        soft: body.IsSoftBody() ? softBodyVertices(jolt, body) : null,
        seenAt: stepIndex,
      };
      tracked.set(bodyID, entry);
      queue("enter", bodyID, volume, readEvent(body, bodyID), true);
    } else {
      entry.seenAt = stepIndex;
      if (entry.volume !== volume) {
        const event = readEvent(body, bodyID);
        queue("exit", bodyID, entry.volume, event, false);
        queue("enter", bodyID, volume, event, false);
        entry.volume = volume;
      }
    }

    const floats = bodies.get(bodyID)?.current.floats ?? 1;
    if (floats <= 0 || !entry.canFloat) return;
    if (!body.IsDynamic() || !body.IsActive()) return;

    if (entry.soft) {
      floatVertices(body, entry.soft, volume, volume.buoyancy * floats);
      return;
    }

    body.ApplyBuoyancyImpulse(
      surface,
      up,
      volume.buoyancy * floats,
      volume.linearDrag,
      volume.angularDrag,
      flow,
      gravity,
      delta,
    );
  };

  const setBox = (volume: WaterVolumeEntry, top: number) => {
    corner.Set(volume.min.x, volume.min.y, volume.min.z);
    box.mMin = corner;
    corner.Set(volume.max.x, top, volume.max.z);
    box.mMax = corner;
  };

  /** A volume that is going away has no one left to tell. */
  const leave = (bodyID: number, record: Tracked, volumeGone = false) => {
    const id = new jolt.BodyID(bodyID);
    const event: WaterEvent = {
      bodyID,
      userData: record.userData,
      position: new Vector3(),
      velocity: new Vector3(),
    };

    if (bodyInterface.IsAdded(id)) {
      const position = bodyInterface.GetPosition(id);
      const velocity = bodyInterface.GetLinearVelocity(id);
      event.position.set(position.GetX(), position.GetY(), position.GetZ());
      event.velocity.set(velocity.GetX(), velocity.GetY(), velocity.GetZ());
    }

    jolt.destroy(id);
    queue("exit", bodyID, volumeGone ? null : record.volume, event, true);
  };

  const run = (stepDelta: number, index: number) => {
    delta = stepDelta;
    time = timing.elapsed;
    stepIndex = index;

    const worldGravity = physicsSystem.GetGravity();
    gravity.Set(worldGravity.GetX(), worldGravity.GetY(), worldGravity.GetZ());

    let reorder = false;

    for (const volume of volumes) {
      if (!volume.changed) continue;
      volume.changed = false;
      reorder = true;

      const { broadPhase: broadPhaseFilter, object } = filtersFor(volume.layer);
      setBox(volume, Math.max(volume.max.y, volume.surfaceLevel));
      bodyInterface.ActivateBodiesInAABox(box, broadPhaseFilter, object);
    }

    if (reorder) volumes.sort(byPriority);

    for (const volume of volumes) {
      // Crests rise above the mean level, so a wavy volume searches all of its box.
      const top = volume.waves
        ? volume.max.y
        : Math.min(volume.max.y, volume.surfaceLevel);
      if (top <= volume.min.y) continue;

      current = volume;
      up.Set(0, 1, 0);
      surface.Set(
        (volume.min.x + volume.max.x) / 2,
        volume.surfaceLevel,
        (volume.min.z + volume.max.z) / 2,
      );
      flow.Set(volume.flow.x, volume.flow.y, volume.flow.z);
      setBox(volume, top);

      const { broadPhase: broadPhaseFilter, object } = filtersFor(volume.layer);
      collector.Reset();
      broadPhase.CollideAABox(box, collector, broadPhaseFilter, object);
    }

    current = null;

    for (const [bodyID, record] of tracked) {
      if (record.seenAt === index) continue;
      tracked.delete(bodyID);
      leave(bodyID, record);
    }
  };

  const deliver = (entry: Pending) => {
    let handler: WaterEventHandler | undefined;

    if (entry.handler === "volume") {
      handler =
        entry.kind === "enter" ? entry.volume?.onEnter : entry.volume?.onExit;
    } else {
      const settings = bodies.get(entry.bodyID)?.current;
      handler =
        entry.kind === "enter" ? settings?.onEnterWater : settings?.onExitWater;
    }

    handler?.(entry.event);
  };

  return {
    addVolume: (volume) => {
      if (destroyed) return () => {};

      volume.changed = true;
      volumes.push(volume);
      unsubscribe ??= steps.add("before", run);

      return () => {
        const at = volumes.indexOf(volume);
        if (at === -1) return;
        volumes.splice(at, 1);

        for (const [bodyID, record] of tracked) {
          if (record.volume !== volume) continue;
          tracked.delete(bodyID);
          leave(bodyID, record, true);
        }

        if (volumes.length === 0) {
          unsubscribe?.();
          unsubscribe = null;
        }
      };
    },

    addBody: (bodyID, settings) => {
      if (destroyed) return () => {};

      bodies.set(bodyID, settings);
      return () => {
        if (bodies.get(bodyID) === settings) bodies.delete(bodyID);
      };
    },

    sample: (point: Vec3Input, target?: WaterSample) => {
      const x = Array.isArray(point) ? point[0] : point.x;
      const y = Array.isArray(point) ? point[1] : point.y;
      const z = Array.isArray(point) ? point[2] : point.z;

      for (const volume of volumes) {
        const { min, max } = volume;
        if (x < min.x || x > max.x || z < min.z || z > max.z) continue;
        if (y < min.y || y > max.y) continue;

        const level = volume.waves
          ? volume.surfaceLevel + volume.waves(x, z, timing.elapsed)
          : volume.surfaceLevel;
        if (y >= level) continue;

        const result = target ?? shared;
        result.depth = level - y;
        result.surfaceLevel = level;
        result.flow.copy(volume.flow);
        return result;
      }

      return null;
    },

    flush: () => {
      if (pending.length === 0) return;

      const batch = pending.splice(0, pending.length);
      for (const entry of batch) deliver(entry);
    },

    destroy: () => {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
      volumes.length = 0;
      bodies.clear();
      tracked.clear();
      pending.length = 0;

      for (const entry of filters.values()) {
        jolt.destroy(entry.object);
        jolt.destroy(entry.broadPhase);
      }
      filters.clear();

      jolt.destroy(collector);
      jolt.destroy(box);
      jolt.destroy(corner);
      jolt.destroy(gravity);
      jolt.destroy(flow);
      jolt.destroy(up);
      jolt.destroy(surface);
    },
  };
};

const shared: WaterSample = { depth: 0, surfaceLevel: 0, flow: new Vector3() };
