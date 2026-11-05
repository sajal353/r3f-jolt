import { Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import {
  addCompoundChildren,
  createBareChildShape,
  describeInvalidChild,
  normalizedRotation,
  type CompoundChild,
} from "./internal/colliderShape";
import {
  refillShapeGeometry,
  shapeToGeometry,
} from "./internal/shapeToGeometry";
import { readBounds, unionBounds, wakeBodiesIn } from "./internal/wakeBodies";
import type { QuatTuple, Vec3Tuple } from "./types";

const HOOK = "useMutableCompound";

export interface UseMutableCompoundOptions extends BodyOptions {
  /** The children at mount. A body that moves needs at least one. */
  shapes: CompoundChild[];
}

export interface MutableCompoundExtras {
  /** The new child's index, or -1 for a child that could not be built. */
  addShape: (child: CompoundChild, index?: number) => number;
  /**
   * Later children move down one, so an index held across this goes stale.
   * Refuses the last child of a body that moves, which would have no mass.
   */
  removeShape: (index: number) => boolean;
  /** Moves a child, and swaps what it is when given `shape`. */
  modifyShape: (
    index: number,
    position: Vec3Tuple,
    rotation?: QuatTuple,
    shape?: CompoundChild,
  ) => void;
  /** Moves a run of children starting at `start`, in one go. */
  modifyShapes: (
    start: number,
    positions: Vec3Tuple[],
    rotations: QuatTuple[],
  ) => void;
  /**
   * Makes the body turn about the middle of what it now holds. Nothing else
   * moves the centre of mass, so a body losing one side keeps turning about a
   * point it no longer has until this is called.
   */
  adjustCenterOfMass: () => void;
  getShapeCount: () => number;
  /** Where a child is, in the frame `shapes` was written in. */
  getShape: (index: number) => { position: Vec3Tuple; rotation: QuatTuple };
}

const readVec3 = (vector: Jolt.Vec3): Vec3Tuple => [
  vector.GetX(),
  vector.GetY(),
  vector.GetZ(),
];

const readQuat = (quat: Jolt.Quat): QuatTuple => [
  quat.GetX(),
  quat.GetY(),
  quat.GetZ(),
  quat.GetW(),
];

const sameTuple = (a: readonly number[], b: readonly number[]) =>
  a.every((value, index) => value === b[index]);

const IDENTITY: QuatTuple = [0, 0, 0, 1];

/** Centre of mass, then inverse mass and inertia, then the child count. */
const CENTRE_VALUES = 3;
const HEADER_VALUES = CENTRE_VALUES + 8 + 1;
/** Which shape, then position and rotation. */
const CHILD_VALUES = 8;

/** Past this the centre of mass is as close as it can be represented. */
const CENTRE_ATTEMPTS = 4;

const spare = { from: new Vector3(), facing: new Quaternion() };

const createExtras = (
  {
    api,
    jolt,
    body,
    shape,
    geometry,
    usable,
    onDispose,
  }: BodyApiContext<Jolt.MutableCompoundShape>,
  options: UseMutableCompoundOptions,
): MutableCompoundExtras => {
  const { bodyInterface, temps } = api;
  const id = body.GetID();
  const tracked = options.stateId !== undefined;
  const fixedMass = Boolean(
    options.massProperties || options.overrideMassProperties,
  );

  const checkIndex = (index: number, caller: string) => {
    const count = shape.GetNumSubShapes();

    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(
        `[r3f-jolt] ${caller}: index ${index} is outside the ${count} children.`,
      );
    }
  };

  /** Jolt keeps a child's position relative to the centre of mass; callers do not. */
  const placeOf = (index: number) => {
    const child = shape.GetSubShape(index);
    const centred = readVec3(child.GetPositionCOM());
    const rotation = readQuat(child.GetRotation());
    const own = readVec3(child.mShape.GetCenterOfMass());
    const centre = readVec3(shape.GetCenterOfMass());

    const offset = spare.from
      .set(own[0], own[1], own[2])
      .applyQuaternion(
        spare.facing.set(rotation[0], rotation[1], rotation[2], rotation[3]),
      );

    return {
      position: [
        centred[0] + centre[0] - offset.x,
        centred[1] + centre[1] - offset.y,
        centred[2] + centre[2] - offset.z,
      ] as Vec3Tuple,
      rotation,
    };
  };

  const writePlaces = (
    start: number,
    positions: Vec3Tuple[],
    rotations: QuatTuple[],
  ) => {
    const positionArray = new jolt.ArrayVec3();
    const rotationArray = new jolt.ArrayQuat();

    positions.forEach((position, index) => {
      positionArray.push_back(temps.vec3(position));
      rotationArray.push_back(temps.quat(normalizedRotation(rotations[index])));
    });

    shape.ModifyShapes(
      start,
      positions.length,
      positionArray.data(),
      rotationArray.data(),
    );

    jolt.destroy(positionArray);
    jolt.destroy(rotationArray);
  };

  /**
   * Writing a child rounds its position once, and writing the result again
   * changes nothing. Keeping every child at that point is what lets a restore
   * land on the exact floats it saved, however the shape got there.
   */
  const settle = () => {
    const count = shape.GetNumSubShapes();
    if (count === 0) return;

    const places = Array.from({ length: count }, (_, index) => placeOf(index));
    writePlaces(
      0,
      places.map((place) => place.position),
      places.map((place) => place.rotation),
    );
  };

  const edit = <T>(change: () => T): T => {
    const before = readBounds(body);
    const previousCentre = readVec3(body.GetShape().GetCenterOfMass());

    const moving = !body.IsStatic();
    const inverseMass = moving ? body.GetMotionProperties().GetInverseMass() : 0;
    const massPerShapeMass =
      moving && inverseMass > 0 && options.mass !== undefined && !fixedMass
        ? 1 / inverseMass / body.GetShape().GetMassProperties().mMass
        : null;

    const result = change();

    if (tracked) settle();

    bodyInterface.NotifyShapeChanged(
      id,
      temps.vec3(previousCentre),
      !fixedMass,
      jolt.EActivation_Activate,
    );

    if (massPerShapeMass !== null) {
      body
        .GetMotionProperties()
        .ScaleToMass(massPerShapeMass * body.GetShape().GetMassProperties().mMass);
    }

    wakeBodiesIn(jolt, bodyInterface, unionBounds(before, readBounds(body)));
    refillShapeGeometry(jolt, shape, geometry);

    return result;
  };

  // A restore has to find a removed child again, and only something with a
  // `stateId` can be restored, so only that keeps them. One per description, so
  // adding the same child again after a rewind reads the same in a snapshot.
  const pieces: Jolt.Shape[] = [];
  const pieceByDescription = new Map<string, number>();
  const pieceByPointer = new Map<number, number>();
  const held: Jolt.Shape[] = [];

  const describeChild = (child: CompoundChild) =>
    JSON.stringify({ ...child, position: undefined, rotation: undefined });

  const keepPiece = (piece: Jolt.Shape, child: CompoundChild) => {
    const description = describeChild(child);
    const index = pieceByDescription.get(description) ?? pieces.length;

    if (index === pieces.length) {
      pieces.push(piece);
      pieceByDescription.set(description, index);
    }

    pieceByPointer.set(jolt.getPointer(piece), index);
    held.push(piece);
  };

  /** Velocity is the centre of mass's, and a spinning body's new one moves differently. */
  const carrySpin = (previousCentre: Vec3Tuple) => {
    if (!body.IsDynamic()) return;

    const [spinX, spinY, spinZ] = readVec3(body.GetAngularVelocity());
    if (spinX === 0 && spinY === 0 && spinZ === 0) return;

    const centre = readVec3(body.GetShape().GetCenterOfMass());
    const facing = readQuat(body.GetRotation());
    const shift = spare.from
      .set(
        centre[0] - previousCentre[0],
        centre[1] - previousCentre[1],
        centre[2] - previousCentre[2],
      )
      .applyQuaternion(
        spare.facing.set(facing[0], facing[1], facing[2], facing[3]),
      );

    const [x, y, z] = readVec3(body.GetLinearVelocity());
    bodyInterface.SetLinearVelocity(
      id,
      temps.vec3([
        x + spinY * shift.z - spinZ * shift.y,
        y + spinZ * shift.x - spinX * shift.z,
        z + spinX * shift.y - spinY * shift.x,
      ]),
    );
  };

  /**
   * A constraint holds its anchors relative to the centre of mass, and the
   * bindings leave out the `Constraint::NotifyShapeChanged` that would carry
   * them across, so a joint on this body ends up that much out of place.
   */
  const warnAboutJoints = () => {
    const own = id.GetIndexAndSequenceNumber();
    const joints = api.constraints.attached().filter(({ constraint }) => {
      if (constraint.GetType() !== jolt.EConstraintType_TwoBodyConstraint) {
        return false;
      }

      const joint = jolt.castObject(constraint, jolt.TwoBodyConstraint);
      return (
        joint.GetBody1().GetID().GetIndexAndSequenceNumber() === own ||
        joint.GetBody2().GetID().GetIndexAndSequenceNumber() === own
      );
    });

    if (joints.length === 0) return;

    console.warn(
      `[r3f-jolt] ${HOOK}: adjustCenterOfMass moved this body's centre of mass, ` +
        `which moves the anchors of ${joints.map((joint) => joint.hook).join(", ")} ` +
        "with it: Jolt's JS bindings cannot tell a constraint. Rebuild the " +
        "constraint with `key` to place it again.",
    );
  };

  const saveShape = () => {
    const count = shape.GetNumSubShapes();
    const moving = !body.IsStatic();
    const motion = moving ? body.GetMotionProperties() : null;

    const values = [
      ...readVec3(shape.GetCenterOfMass()),
      motion?.GetInverseMass() ?? 0,
      ...(motion ? readVec3(motion.GetInverseInertiaDiagonal()) : [0, 0, 0]),
      ...(motion ? readQuat(motion.GetInertiaRotation()) : IDENTITY),
      count,
    ];

    for (let index = 0; index < count; index += 1) {
      const child = shape.GetSubShape(index);
      const which = pieceByPointer.get(jolt.getPointer(child.mShape)) ?? -1;
      const centred = readVec3(child.GetPositionCOM());
      values.push(which, ...centred, ...readQuat(child.GetRotation()));
    }

    return values;
  };

  let ballast: Jolt.Shape | null = null;

  /**
   * Only `AdjustCenterOfMass` can move the centre of mass, and it moves it to
   * the middle of the children. A lone child at the target pulls it there.
   */
  const moveCentreTo = (centre: Vec3Tuple) => {
    ballast ??= (() => {
      const sphere = new jolt.SphereShape(1, undefined);
      sphere.AddRef();
      return sphere;
    })();

    shape.AddShape(temps.vec3(centre), temps.quat(IDENTITY), ballast, 0);

    for (
      let attempt = 0;
      attempt < CENTRE_ATTEMPTS &&
      !sameTuple(readVec3(shape.GetCenterOfMass()), centre);
      attempt += 1
    ) {
      shape.ModifyShape(0, temps.vec3(centre), temps.quat(IDENTITY));
      shape.AdjustCenterOfMass();
    }

    shape.RemoveShape(0);
  };

  const rebuild = (values: number[]) => {
    for (let index = shape.GetNumSubShapes() - 1; index >= 0; index -= 1) {
      shape.RemoveShape(index);
    }

    const centre = values.slice(0, CENTRE_VALUES) as Vec3Tuple;
    moveCentreTo(centre);

    for (let at = HEADER_VALUES; at < values.length; at += CHILD_VALUES) {
      const piece = pieces[values[at]];
      const rotation = values.slice(at + 4, at + 8) as QuatTuple;
      const own = readVec3(piece.GetCenterOfMass());
      const offset = spare.from
        .set(own[0], own[1], own[2])
        .applyQuaternion(
          spare.facing.set(rotation[0], rotation[1], rotation[2], rotation[3]),
        );

      shape.AddShape(
        temps.vec3([
          values[at + 1] + centre[0] - offset.x,
          values[at + 2] + centre[1] - offset.y,
          values[at + 3] + centre[2] - offset.z,
        ]),
        temps.quat(rotation),
        piece,
        0,
      );
    }
  };

  const restoreShape = (values: number[]) => {
    const live = saveShape();
    const sameShape =
      live.length === values.length &&
      sameTuple(live.slice(0, CENTRE_VALUES), values.slice(0, CENTRE_VALUES)) &&
      sameTuple(live.slice(HEADER_VALUES), values.slice(HEADER_VALUES));

    if (!sameShape) {
      for (let at = HEADER_VALUES; at < values.length; at += CHILD_VALUES) {
        if (values[at] < 0 || values[at] >= pieces.length) {
          throw new Error(
            `r3f-jolt: restoreState: the snapshot has a ${HOOK} child this one ` +
              "has never held. A snapshot only restores into a compound that " +
              "has had the same children added, in the same order.",
          );
        }
      }

      const previousCentre = readVec3(body.GetShape().GetCenterOfMass());
      rebuild(values);
      bodyInterface.NotifyShapeChanged(
        id,
        temps.vec3(previousCentre),
        false,
        jolt.EActivation_DontActivate,
      );
      refillShapeGeometry(jolt, shape, geometry);
    }

    if (!body.IsStatic()) {
      const motion = body.GetMotionProperties();
      motion.SetInverseMass(values[CENTRE_VALUES]);
      motion.SetInverseInertia(
        temps.vec3(values.slice(CENTRE_VALUES + 1, CENTRE_VALUES + 4) as Vec3Tuple),
        temps.quat(values.slice(CENTRE_VALUES + 4, CENTRE_VALUES + 8) as QuatTuple),
      );
    }
  };

  if (tracked) {
    const children = options.shapes.filter(
      (child) => !describeInvalidChild(child),
    );

    children.forEach((child, index) => {
      const piece = shape.GetSubShape(index).mShape;
      piece.AddRef();
      keepPiece(piece, child);
    });

    settle();

    onDispose(
      api.snapshots.keep({
        tag: "shape",
        owner: "body",
        id: id.GetIndexAndSequenceNumber(),
        save: saveShape,
        restore: restoreShape,
      }),
    );
  }

  onDispose(() => {
    if (api.state.destroyed) return;
    for (const piece of held) piece.Release();
    ballast?.Release();
  });

  /** The caller holds a reference to the result until `donePiece`. */
  const buildPiece = (child: CompoundChild, caller: string) => {
    const problem = describeInvalidChild(child);

    if (problem) {
      console.error(
        `[r3f-jolt] ${caller}: ${child.type} child refused — ${problem}.`,
      );
      return null;
    }

    const kept = tracked
      ? pieceByDescription.get(describeChild(child))
      : undefined;
    if (kept !== undefined) return pieces[kept];

    const piece = createBareChildShape(jolt, child, HOOK);
    if (tracked) keepPiece(piece, child);
    return piece;
  };

  const donePiece = (piece: Jolt.Shape) => {
    if (!tracked) piece.Release();
  };

  return {
    addShape: (child: CompoundChild, index?: number) => {
      if (!usable()) return -1;

      const piece = buildPiece(child, "addShape");
      if (!piece) return -1;

      const added = edit(() =>
        shape.AddShape(
          temps.vec3(child.position),
          temps.quat(normalizedRotation(child.rotation)),
          piece,
          0,
          index,
        ),
      );

      donePiece(piece);
      return added;
    },

    removeShape: (index: number) => {
      if (!usable()) return false;
      checkIndex(index, "removeShape");

      if (shape.GetNumSubShapes() === 1 && !body.IsStatic()) {
        console.warn(
          `[r3f-jolt] removeShape: refusing the last child of a ${HOOK} that ` +
            "moves, which would leave it with no mass. Use api.kill instead.",
        );
        return false;
      }

      edit(() => shape.RemoveShape(index));
      return true;
    },

    modifyShape: (
      index: number,
      position: Vec3Tuple,
      rotation?: QuatTuple,
      child?: CompoundChild,
    ) => {
      if (!usable()) return;
      checkIndex(index, "modifyShape");

      const facing = normalizedRotation(
        rotation ?? readQuat(shape.GetSubShape(index).GetRotation()),
      );
      const piece = child ? buildPiece(child, "modifyShape") : null;
      if (child && !piece) return;

      edit(() => {
        if (piece) {
          shape.ModifyShape(
            index,
            temps.vec3(position),
            temps.quat(facing),
            piece,
          );
        } else {
          shape.ModifyShape(index, temps.vec3(position), temps.quat(facing));
        }
      });

      if (piece) donePiece(piece);
    },

    modifyShapes: (
      start: number,
      positions: Vec3Tuple[],
      rotations: QuatTuple[],
    ) => {
      if (!usable()) return;

      if (positions.length !== rotations.length) {
        throw new Error(
          `[r3f-jolt] modifyShapes: ${positions.length} positions but ` +
            `${rotations.length} rotations.`,
        );
      }

      if (positions.length === 0) return;
      checkIndex(start, "modifyShapes");
      checkIndex(start + positions.length - 1, "modifyShapes");

      edit(() => writePlaces(start, positions, rotations));
    },

    adjustCenterOfMass: () => {
      if (!usable()) return;

      const previous = readVec3(body.GetShape().GetCenterOfMass());
      edit(() => shape.AdjustCenterOfMass());
      carrySpin(previous);

      if (!sameTuple(previous, readVec3(body.GetShape().GetCenterOfMass()))) {
        warnAboutJoints();
      }
    },

    getShapeCount: () => shape.GetNumSubShapes(),

    getShape: (index: number) => {
      checkIndex(index, "getShape");
      return placeOf(index);
    },
  };
};

/**
 * A compound whose children change at runtime, for a crate that loses planks or
 * a turret that gains armour. `api.geometry` is rebuilt in place on every change
 * and is the shape as Jolt holds it. Slower to collide with than `useCompound`,
 * so use this one only when the children really do change.
 */
export const useMutableCompound = (options: UseMutableCompoundOptions) => {
  const { shapes, motionType } = options;

  return useBody<Jolt.MutableCompoundShape, MutableCompoundExtras>(
    (jolt) => {
      if (
        motionType !== "static" &&
        !shapes.some((child) => !describeInvalidChild(child))
      ) {
        throw new Error(
          `[r3f-jolt] ${HOOK}: a body that moves needs at least one valid ` +
            "child, or it has no mass.",
        );
      }

      const settings = new jolt.MutableCompoundShapeSettings();
      addCompoundChildren(jolt, settings, shapes, HOOK);

      const result = settings.Create();
      jolt.destroy(settings);

      const shape = shapeFromResultAs(
        jolt,
        result,
        jolt.MutableCompoundShape,
        HOOK,
      );

      return { shape, geometry: shapeToGeometry(jolt, shape) };
    },
    options,
    "mutableCompound",
    (context) => createExtras(context, options),
  );
};
