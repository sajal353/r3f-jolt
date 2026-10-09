import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  type MeshBasicMaterial,
} from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createMotionDebugMaterials,
  DEBUG_RENDER_ORDER,
} from "./internal/debugMaterial";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import {
  createConstraintDebugLines,
  type ConstraintDebugLines,
} from "./internal/constraintDebug";
import {
  createTransformTracker,
  type TransformTracker,
} from "./internal/interpolate";
import { motionTypeName } from "./internal/motionType";
import {
  softBodyVertices,
  type SoftBodyVertices,
} from "./internal/softBodyVertices";
import {
  createVertexTracker,
  type VertexTracker,
} from "./internal/softBodyTracker";
import type { MotionType } from "./types";

export interface PhysicsDebugProps {
  /** Wireframe colour per motion type. Any omitted key keeps its default. */
  colors?: Partial<Record<MotionType, string>>;
  /**
   * Draw the joints as well as the bodies. Only constraints created by the
   * hooks are known — Jolt exposes no way to enumerate a world's constraints,
   * so one built by hand through `useJolt()` cannot be drawn.
   */
  constraints?: boolean;
}

interface TrackedBody {
  mesh: Mesh;
  shapePointer: number;
  transform: TransformTracker;
  /** A soft body's shape never changes identity, so it is redrawn from its vertices. */
  soft: { layout: SoftBodyVertices; vertices: VertexTracker } | null;
}

const softBodyGeometry = (layout: SoftBodyVertices) => {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(layout.count * 3), 3);
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setIndex(new BufferAttribute(layout.faces, 1));
  return geometry;
};

const forgetMesh = (entry: TrackedBody, release: (pointer: number) => void) => {
  if (entry.soft) entry.mesh.geometry.dispose();
  else release(entry.shapePointer);
};

interface CachedGeometry {
  geometry: BufferGeometry;
  users: number;
}

interface DebugState {
  tracked: Map<number, TrackedBody>;
  materials: Record<MotionType, MeshBasicMaterial>;
  ids: Jolt.BodyIDVector;
  joints: ConstraintDebugLines | null;
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
export const PhysicsDebug = ({
  colors,
  constraints = true,
}: PhysicsDebugProps = {}) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);
  const stateRef = useRef<DebugState | null>(null);

  // Snapshotted like the other init-once options: change them with `key`.
  const [mount] = useState(() => ({ colors, constraints }));

  useEffect(() => {
    const { Jolt: jolt } = api;
    const geometries = new Map<number, CachedGeometry>();

    const state: DebugState = {
      tracked: new Map(),
      materials: createMotionDebugMaterials(mount.colors),
      ids: new jolt.BodyIDVector(),
      joints: mount.constraints ? createConstraintDebugLines() : null,

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
        if (state.joints) {
          scene.remove(state.joints.lines);
          state.joints.dispose();
        }

        for (const { mesh, soft } of state.tracked.values()) {
          scene.remove(mesh);
          if (soft) mesh.geometry.dispose();
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

    if (state.joints) scene.add(state.joints.lines);

    stateRef.current = state;

    return () => {
      stateRef.current = null;
      state.dispose();

      if (!api.state.destroyed) {
        jolt.destroy(state.ids);
      }
    };
  }, [api, scene, mount]);

  useFrame(() => {
    const state = stateRef.current;
    if (!state || api.state.disposed) return;

    const { Jolt: jolt, physicsSystem, bodyInterface } = api;
    const { tracked, materials, ids, joints, acquire, release } = state;

    joints?.update((draw) => api.constraints.forEach(draw));

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
        forgetMesh(entry, release);
        tracked.delete(key);
        entry = undefined;
      }

      const body = physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(id);
      const valid = Boolean(body) && jolt.getPointer(body) !== 0;

      if (!entry) {
        const soft =
          valid && body.IsSoftBody() ? softBodyVertices(jolt, body) : null;
        const mesh = new Mesh(
          soft ? softBodyGeometry(soft) : acquire(shapePointer, shape),
        );
        mesh.frustumCulled = false;
        mesh.renderOrder = DEBUG_RENDER_ORDER;
        scene.add(mesh);
        entry = {
          mesh,
          shapePointer,
          transform: createTransformTracker(),
          soft: soft
            ? { layout: soft, vertices: createVertexTracker(soft.count) }
            : null,
        };
        tracked.set(key, entry);
      }

      entry.mesh.material =
        materials[motionTypeName(jolt, bodyInterface.GetMotionType(id))];

      if (!valid) continue;

      if (entry.soft) {
        const { layout, vertices } = entry.soft;
        const changed = body.IsActive()
          ? vertices.update(jolt, body, layout, api.timing)
          : vertices.rest(jolt, body, layout);

        if (changed) {
          const position = entry.mesh.geometry.getAttribute(
            "position",
          ) as BufferAttribute;
          (position.array as Float32Array).set(vertices.local);
          position.needsUpdate = true;
        }
        entry.mesh.position.copy(vertices.origin);
        continue;
      }

      // Interpolated like the bodies themselves: a wireframe that snapped while
      // its mesh blended would drift visibly apart, which is the opposite of
      // what a debug overlay is for.
      entry.transform.update(body, api.timing);
      entry.transform.applyTo(entry.mesh);
    }

    for (const [key, entry] of tracked) {
      if (seen.has(key)) continue;

      scene.remove(entry.mesh);
      forgetMesh(entry, release);
      tracked.delete(key);
    }
  });

  return null;
};
