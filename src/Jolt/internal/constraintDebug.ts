import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from "three";
import type Jolt from "jolt-physics";
import {
  DEBUG_RENDER_ORDER,
  createConstraintDebugMaterial,
} from "./debugMaterial";
import type { ConstraintEntry } from "../types";

const SEGMENTS_PER_CONSTRAINT = 3;
const VERTICES_PER_SEGMENT = 2;
const FLOATS_PER_CONSTRAINT =
  SEGMENTS_PER_CONSTRAINT * VERTICES_PER_SEGMENT * 3;

export interface ConstraintDebugLines {
  lines: LineSegments;
  update: (visit: (draw: (entry: ConstraintEntry) => void) => void) => void;
  dispose: () => void;
}

const readCentre = (body: Jolt.Body, out: Vector3) => {
  const centre = body.GetCenterOfMassPosition();
  return out.set(centre.GetX(), centre.GetY(), centre.GetZ());
};

const readAnchor = (body: Jolt.Body, frame: Jolt.Mat44, out: Vector3) => {
  const local = frame.GetTranslation();
  const world = body.GetCenterOfMassTransform().MulVec3(local);
  return out.set(world.GetX(), world.GetY(), world.GetZ());
};

/**
 * One buffer for however many joints are drawn, so a world full of constraints
 * still costs a single draw call.
 *
 * Each joint is body 1's centre → its anchor → body 2's anchor → body 2's
 * centre. The middle segment is the joint itself and has zero length while the
 * constraint holds, so a visible line there is the solver failing to close it.
 */
export const createConstraintDebugLines = (): ConstraintDebugLines => {
  const geometry = new BufferGeometry();
  const lines = new LineSegments(geometry, createConstraintDebugMaterial());
  lines.renderOrder = DEBUG_RENDER_ORDER;
  lines.frustumCulled = false;

  const centre1 = new Vector3();
  const anchor1 = new Vector3();
  const anchor2 = new Vector3();
  const centre2 = new Vector3();

  let positions = new Float32Array(0);
  let written = 0;

  const grow = () => {
    const capacity = Math.max(positions.length * 2, FLOATS_PER_CONSTRAINT * 8);
    const next = new Float32Array(capacity);
    next.set(positions);
    positions = next;
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
  };

  const writePoint = (from: Vector3, to: Vector3) => {
    positions[written] = from.x;
    positions[written + 1] = from.y;
    positions[written + 2] = from.z;
    positions[written + 3] = to.x;
    positions[written + 4] = to.y;
    positions[written + 5] = to.z;
    written += 6;
  };

  const draw = (entry: ConstraintEntry) => {
    if (written + FLOATS_PER_CONSTRAINT > positions.length) grow();

    const { constraint, body1, body2 } = entry;

    readCentre(body1, centre1);
    readAnchor(body1, constraint.GetConstraintToBody1Matrix(), anchor1);
    readCentre(body2, centre2);
    readAnchor(body2, constraint.GetConstraintToBody2Matrix(), anchor2);

    writePoint(centre1, anchor1);
    writePoint(anchor1, anchor2);
    writePoint(anchor2, centre2);
  };

  const update: ConstraintDebugLines["update"] = (visit) => {
    written = 0;
    visit(draw);

    const attribute = geometry.getAttribute("position");
    if (!attribute) return;

    attribute.needsUpdate = true;
    geometry.setDrawRange(0, written / 3);
  };

  const dispose = () => {
    geometry.dispose();
    lines.material.dispose();
  };

  return { lines, update, dispose };
};
