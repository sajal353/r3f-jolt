import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Line, Matrix4, Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintApiContext,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import {
  createJoltPath,
  resolvePathSource,
  samplePath,
  type CustomPath,
  type PathPoint,
} from "./internal/constraintPath";
import {
  applyMotor,
  resolveMotorState,
  type MotorLimits,
  type MotorState,
} from "./internal/constraintSettings";
import { createConstraintDebugMaterial } from "./internal/debugMaterial";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./internal/debugView";
import type { JoltModule, QuatTuple, Temps, Vec3Tuple } from "./types";

/**
 * How body 2 may turn on the path. `"path"` turns it with the path, as a
 * coaster car does, and `"fixed"` keeps it as it was, as a lift does. The
 * `around…` ones leave one rotation free, about that axis of the path.
 */
export type PathRotation =
  | "free"
  | "aroundTangent"
  | "aroundNormal"
  | "aroundBinormal"
  | "path"
  | "fixed";

export interface PathMotorOptions extends MotorLimits {
  state?: MotorState;
  /** Where a position motor drives to, in path fraction rather than metres. */
  targetFraction?: number;
  /** Metres per second along the path, towards rising fraction. */
  targetVelocity?: number;
}

export interface UsePathConstraintOptions extends ConstraintOptions {
  /** A curve through these points. Fraction `i` is at point `i`. */
  points?: readonly PathPoint[];
  /** Joins the last of `points` back to the first. */
  looping?: boolean;
  /** Computes the path yourself, in place of `points`. */
  path?: CustomPath;
  /** Where the path's origin sits on body 1. */
  pathPosition?: Vec3Tuple;
  pathRotation?: QuatTuple;
  /** Where on the path body 2 starts. It holds its offset from that point. */
  pathFraction?: number;
  rotation?: PathRotation;
  /** Newtons that resist sliding along the path. */
  maxFrictionForce?: number;
  motor?: PathMotorOptions;
}

export interface PathConstraintExtras {
  setMotorState: (state: MotorState) => void;
  setTargetVelocity: (metresPerSecond: number) => void;
  setTargetFraction: (fraction: number) => void;
  /** Where on the path body 2 is. */
  getPathFraction: () => number;
  setMaxFrictionForce: (force: number) => void;
}

export type PathConstraintApi = ConstraintApi<Jolt.PathConstraint> &
  PathConstraintExtras;

const HOOK = "usePathConstraint";

const resolveRotation = (jolt: JoltModule, rotation: PathRotation) => {
  if (rotation === "aroundTangent") {
    return jolt.EPathRotationConstraintType_ConstrainAroundTangent;
  }
  if (rotation === "aroundNormal") {
    return jolt.EPathRotationConstraintType_ConstrainAroundNormal;
  }
  if (rotation === "aroundBinormal") {
    return jolt.EPathRotationConstraintType_ConstrainAroundBinormal;
  }
  if (rotation === "path") return jolt.EPathRotationConstraintType_ConstrainToPath;
  if (rotation === "fixed") {
    return jolt.EPathRotationConstraintType_FullyConstrained;
  }
  return jolt.EPathRotationConstraintType_Free;
};

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UsePathConstraintOptions,
  path: Jolt.PathConstraintPath,
) => {
  const settings = new jolt.PathConstraintSettings();

  settings.mPath = path;
  settings.mPathFraction = options.pathFraction ?? 0;
  settings.mRotationConstraintType = resolveRotation(
    jolt,
    options.rotation ?? "free",
  );

  if (options.pathPosition) {
    settings.mPathPosition = temps.vec3(options.pathPosition);
  }
  if (options.pathRotation) {
    const [x, y, z, w] = options.pathRotation;
    const rotation = new jolt.Quat(x, y, z, w);
    settings.mPathRotation = rotation;
    jolt.destroy(rotation);
  }
  if (options.maxFrictionForce !== undefined) {
    settings.mMaxFrictionForce = options.maxFrictionForce;
  }

  applyMotor(
    jolt,
    (motor) => (settings.mPositionMotorSettings = motor),
    options.motor,
  );

  return settings;
};

const castPath = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.PathConstraint);

const createPathApi = (
  { constraint, usable, activate, jolt }: ConstraintApiContext<Jolt.PathConstraint>,
  motor: PathMotorOptions | undefined,
): PathConstraintExtras => {
  const setMotorState = (state: MotorState) => {
    if (!usable()) return;
    constraint.SetPositionMotorState(resolveMotorState(jolt, state));
    activate();
  };

  const setTargetVelocity = (metresPerSecond: number) => {
    if (!usable()) return;
    constraint.SetTargetVelocity(metresPerSecond);
    activate();
  };

  const setTargetFraction = (fraction: number) => {
    if (!usable()) return;
    constraint.SetTargetPathFraction(fraction);
    activate();
  };

  const setMaxFrictionForce = (force: number) => {
    if (!usable()) return;
    constraint.SetMaxFrictionForce(force);
    activate();
  };

  if (motor?.targetFraction !== undefined) setTargetFraction(motor.targetFraction);
  if (motor?.targetVelocity !== undefined) setTargetVelocity(motor.targetVelocity);
  if (motor?.state) setMotorState(motor.state);

  return {
    setMotorState,
    setTargetVelocity,
    setTargetFraction,
    getPathFraction: () => (usable() ? constraint.GetPathFraction() : 0),
    setMaxFrictionForce,
  };
};

/** Puts a path's debug line where the path is: on body 1, at its own offset. */
const createLinePlacer = () => {
  const bodyMatrix = new Matrix4();
  const pathMatrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const unit = new Vector3(1, 1, 1);

  return (
    line: Line,
    owner: Jolt.Body,
    { pathPosition = [0, 0, 0], pathRotation = [0, 0, 0, 1] }: UsePathConstraintOptions,
  ) => {
    const at = owner.GetPosition();
    const turn = owner.GetRotation();
    position.set(at.GetX(), at.GetY(), at.GetZ());
    rotation.set(turn.GetX(), turn.GetY(), turn.GetZ(), turn.GetW());
    bodyMatrix.compose(position, rotation, unit);

    position.fromArray(pathPosition);
    rotation.fromArray(pathRotation);
    pathMatrix.compose(position, rotation, unit);

    line.matrix.multiplyMatrices(bodyMatrix, pathMatrix);
    line.matrixWorldNeedsUpdate = true;
  };
};

/**
 * Body 2 travels along a path fixed to body 1, or to the world with `null`: a
 * lift, a platform on a route, a coaster car. Add a `motor` to drive it.
 */
export const usePathConstraint = (
  body1: ConstraintBody | undefined,
  body2: ConstraintBody | undefined,
  options: UsePathConstraintOptions,
) => {
  const scene = useThree((state) => state.scene);
  const [mount] = useState(() => options);

  // Held by the hook as well as the joint, and let go after it.
  const heldPath = useRef<Jolt.PathConstraintPath | null>(null);

  const result = useConstraint<Jolt.PathConstraint, PathConstraintExtras>(
    body1,
    body2,
    options,
    {
      hook: HOOK,
      settings: (jolt, temps) => {
        const path = createJoltPath(
          jolt,
          resolvePathSource(
            mount.points,
            mount.looping ?? false,
            mount.path,
            HOOK,
          ),
        );
        path.AddRef();
        heldPath.current = path;
        return buildSettings(jolt, temps, mount, path);
      },
      cast: castPath,
      api: (context) => createPathApi(context, mount.motor),
      release: () => {
        heldPath.current?.Release();
        heldPath.current = null;
      },
    },
  );

  const [constraintApi] = result;

  const debugViewRef = useRef<DebugView<Line> | null>(null);

  useEffect(() => {
    if (!constraintApi) return;

    const buildLine = () => {
      const line = new Line(
        new BufferGeometry().setFromPoints(samplePath(mount)),
        createConstraintDebugMaterial(),
      );
      line.frustumCulled = false;
      line.matrixAutoUpdate = false;
      scene.add(line);
      return line;
    };

    const releaseLine = (line: Line) => {
      scene.remove(line);
      line.geometry.dispose();
      (line.material as { dispose: () => void }).dispose();
    };

    const view = createDebugView(buildLine, releaseLine);
    debugViewRef.current = view;

    return () => {
      view.hide();
      debugViewRef.current = null;
    };
  }, [constraintApi, mount, scene]);

  const debug = useDebugFlag(mount.debug);
  useDebugView(constraintApi, debugViewRef, debug);

  const [placeLine] = useState(createLinePlacer);

  useFrame(function syncPathLine() {
    const line = debugViewRef.current?.current;
    if (line && constraintApi) placeLine(line, constraintApi.body1, mount);
  });

  return result;
};
