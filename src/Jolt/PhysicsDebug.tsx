import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, type BufferGeometry, type MeshBasicMaterial } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createMotionDebugMaterials,
  DEBUG_RENDER_ORDER,
} from "./internal/debugMaterial";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import {
  createTransformTracker,
  type TransformTracker,
} from "./internal/interpolate";
import { motionTypeName } from "./internal/motionType";
import type { MotionType } from "./types";

export interface PhysicsDebugProps {
  /** Wireframe colour per motion type. Any omitted key keeps its default. */
  colors?: Partial<Record<MotionType, string>>;
}

interface TrackedBody {
  mesh: Mesh;
  shapePointer: number;
  transform: TransformTracker;
}

interface CachedGeometry {
  geometry: BufferGeometry;
  users: number;
}

interface DebugState {
  tracked: Map<number, TrackedBody>;
  materials: Record<MotionType, MeshBasicMaterial>;
  ids: Jolt.BodyIDVector;
  acquire: (pointer: number, shape: Jolt.Shape) => BufferGeometry;
  release: (pointer: number) => void;
  dispose: () => void;
}

/**
 * Draws every body in the world, including ones created directly through
 * `useJolt()` rather than by a hook — which is the gap the per-hook `debug` flag
 * cannot close, since it only knows about the bodies it made itself.
 *
 * Geometry is cached by shape pointer, so a hundred bodies sharing one shape
 * cost one `BufferGeometry` between them.
 */
export const PhysicsDebug = ({ colors }: PhysicsDebugProps = {}) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);
  const stateRef = useRef<DebugState | null>(null);

  // Snapshotted like the other init-once options: change them with `key`.
  const [mountColors] = useState(() => colors);

  useEffect(() => {
    const { Jolt: jolt } = api;
    const geometries = new Map<number, CachedGeometry>();

    const state: DebugState = {
      tracked: new Map(),
      materials: createMotionDebugMaterials(mountColors),
      ids: new jolt.BodyIDVector(),

      acquire: (pointer, shape) => {
        const cached = geometries.get(pointer);
        if (cached) {
          cached.users += 1;
          return cached.geometry;
        }

        const geometry = shapeToGeometry(jolt, shape);
        geometries.set(pointer, { geometry, users: 1 });
        return geometry;
      },

      release: (pointer) => {
        const cached = geometries.get(pointer);
        if (!cached) return;

        cached.users -= 1;
        if (cached.users > 0) return;

        cached.geometry.dispose();
        geometries.delete(pointer);
      },

      dispose: () => {
        for (const { mesh } of state.tracked.values()) {
          scene.remove(mesh);
        }
        state.tracked.clear();

        for (const { geometry } of geometries.values()) {
          geometry.dispose();
        }
        geometries.clear();

        for (const material of Object.values(state.materials)) {
          material.dispose();
        }
      },
    };

    stateRef.current = state;

    return () => {
      stateRef.current = null;
      state.dispose();

      if (!api.state.destroyed) {
        jolt.destroy(state.ids);
      }
    };
  }, [api, scene, mountColors]);

  useFrame(() => {
    const state = stateRef.current;
    if (!state || api.state.disposed) return;

    const { Jolt: jolt, physicsSystem, bodyInterface } = api;
    const { tracked, materials, ids, acquire, release } = state;

    physicsSystem.GetBodies(ids);

    const seen = new Set<number>();

    for (let index = 0; index < ids.size(); index += 1) {
      const id = ids.at(index);
      const key = id.GetIndexAndSequenceNumber();
      seen.add(key);

      const shape = bodyInterface.GetShape(id);
      const shapePointer = jolt.getPointer(shape);

      let entry = tracked.get(key);

      // A body whose shape was swapped — by a runtime rescale, or by hand
      // through `useJolt()` — needs its wireframe rebuilt, not repositioned.
      if (entry && entry.shapePointer !== shapePointer) {
        scene.remove(entry.mesh);
        release(entry.shapePointer);
        tracked.delete(key);
        entry = undefined;
      }

      if (!entry) {
        const mesh = new Mesh(acquire(shapePointer, shape));
        mesh.frustumCulled = false;
        mesh.renderOrder = DEBUG_RENDER_ORDER;
        scene.add(mesh);
        entry = { mesh, shapePointer, transform: createTransformTracker() };
        tracked.set(key, entry);
      }

      entry.mesh.material =
        materials[motionTypeName(jolt, bodyInterface.GetMotionType(id))];

      // Interpolated like the bodies themselves: a wireframe that snapped while
      // its mesh blended would drift visibly apart, which is the opposite of
      // what a debug overlay is for.
      const body = physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(id);

      if (body && jolt.getPointer(body) !== 0) {
        entry.transform.update(body, api.timing);
        entry.transform.applyTo(entry.mesh);
      }
    }

    for (const [key, entry] of tracked) {
      if (seen.has(key)) continue;

      scene.remove(entry.mesh);
      release(entry.shapePointer);
      tracked.delete(key);
    }
  });

  return null;
};
