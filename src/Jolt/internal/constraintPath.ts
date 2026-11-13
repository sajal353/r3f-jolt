import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import type { JoltModule, Vec3Tuple } from "../types";

/** One knot of a path built from `points`. */
export interface PathPoint {
  position: Vec3Tuple;
  /**
   * The curve's direction and pull through this point: a longer tangent holds
   * the direction for longer. Left out, it runs from the point before to the
   * point after.
   */
  tangent?: Vec3Tuple;
  /**
   * Which way is up for a body following the path. Left out, it is world up, or
   * the previous point's where the path runs straight up.
   */
  normal?: Vec3Tuple;
}

export interface PathSample {
  position: Vector3;
  /** Along the path, in the direction of rising fraction. Any length. */
  tangent: Vector3;
  /** Roughly up. It is squared against the tangent afterwards. */
  normal: Vector3;
}

/** A path you compute yourself, called by Jolt during the step. */
export interface CustomPath {
  /** The fraction at the far end of the path. */
  maxFraction: number;
  /** Fraction `maxFraction` joins back to 0. Needs distinct ends. */
  looping?: boolean;
  /** Writes the path at `fraction` into `out`. Runs often, so do not allocate. */
  at: (fraction: number, out: PathSample) => void;
  /**
   * The fraction nearest `position`, given the last one. By default the whole
   * path is searched, which on a path that crosses itself can jump tracks.
   */
  closest?: (position: Vector3, hint: number) => number;
}

/** Per search: spaced samples to find the valley, then narrowing to its floor. */
const SEARCH_SAMPLES = 16;
const REFINE_STEPS = 16;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** How far either side of the last fraction a `points` path looks, in fraction. */
const POINTS_REACH = 1;

const DEGENERATE_SAMPLES = 8;
const UP: Vec3Tuple = [0, 1, 0];
const FORWARD: Vec3Tuple = [0, 0, 1];
const NEARLY_PARALLEL = 0.999;

interface Knot {
  position: Vector3;
  tangent: Vector3;
  normal: Vector3;
}

const fromTuple = (value: Vec3Tuple) =>
  new Vector3(value[0], value[1], value[2]);

const tangentAt = (
  points: readonly PathPoint[],
  index: number,
  looping: boolean,
) => {
  const own = points[index].tangent;
  if (own) return fromTuple(own);

  const count = points.length;
  const before = looping ? (index + count - 1) % count : Math.max(index - 1, 0);
  const after = looping ? (index + 1) % count : Math.min(index + 1, count - 1);

  return fromTuple(points[after].position)
    .sub(fromTuple(points[before].position))
    .multiplyScalar(before === index || after === index ? 1 : 0.5);
};

const buildKnots = (points: readonly PathPoint[], looping: boolean) => {
  let previous = fromTuple(FORWARD);

  return points.map((point, index): Knot => {
    const tangent = tangentAt(points, index, looping);
    const up = fromTuple(UP);
    const vertical =
      Math.abs(tangent.clone().normalize().dot(up)) > NEARLY_PARALLEL;
    const normal = point.normal
      ? fromTuple(point.normal)
      : vertical
        ? previous.clone()
        : up;

    previous = normal;
    return { position: fromTuple(point.position), tangent, normal };
  });
};

/** Jolt's `PathConstraintPathHermite`, which its bindings cannot construct. */
const hermiteAt = (knots: readonly Knot[], looping: boolean) => {
  const count = knots.length;

  return (fraction: number, out: PathSample) => {
    let index = Math.floor(fraction);
    let t = fraction - index;

    if (looping) {
      if (index < 0) index += (Math.trunc(-index / count) + 1) * count;
      index %= count;
    } else if (index < 0) {
      index = 0;
      t = 0;
    } else if (index >= count - 1) {
      index = count - 2;
      t = 1;
    }

    const from = knots[index];
    const to = knots[(index + 1) % count];

    const t2 = t * t;
    const t3 = t * t2;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const d00 = 6 * (t2 - t);
    const d10 = 3 * t2 - 4 * t + 1;
    const d11 = 3 * t2 - 2 * t;

    out.position
      .copy(from.position)
      .multiplyScalar(h00)
      .addScaledVector(from.tangent, h10)
      .addScaledVector(to.position, h01)
      .addScaledVector(to.tangent, h11);
    out.tangent
      .copy(from.position)
      .multiplyScalar(d00)
      .addScaledVector(from.tangent, d10)
      .addScaledVector(to.position, -d00)
      .addScaledVector(to.tangent, d11);
    out.normal
      .copy(from.normal)
      .multiplyScalar(1 - t)
      .addScaledVector(to.normal, t);
  };
};

const createSample = (): PathSample => ({
  position: new Vector3(),
  tangent: new Vector3(),
  normal: new Vector3(),
});

/**
 * Searches outwards from the last fraction rather than along the whole path, so
 * a coaster passing under its own track stays on the track it is on. Jolt's
 * Hermite search looks everywhere, and takes the nearer one.
 */
const createNearest = (
  at: CustomPath["at"],
  maxFraction: number,
  looping: boolean,
  reach: number,
) => {
  const sample = createSample();
  const wrap = (fraction: number) =>
    ((fraction % maxFraction) + maxFraction) % maxFraction;

  return (position: Vector3, hint: number) => {
    const low = looping ? hint - reach : Math.max(hint - reach, 0);
    const high = looping ? hint + reach : Math.min(hint + reach, maxFraction);
    const spacing = (high - low) / SEARCH_SAMPLES;

    // A looping search runs past both ends; the path itself only ever sees
    // fractions on it.
    const distanceAt = (fraction: number) => {
      at(looping ? wrap(fraction) : fraction, sample);
      return sample.position.distanceToSquared(position);
    };

    let best = low;
    let bestDistance = Infinity;
    for (let step = 0; step <= SEARCH_SAMPLES; step += 1) {
      const fraction = low + step * spacing;
      const distance = distanceAt(fraction);
      if (distance < bestDistance) {
        best = fraction;
        bestDistance = distance;
      }
    }

    let left = Math.max(best - spacing, low);
    let right = Math.min(best + spacing, high);
    let inner1 = right - GOLDEN * (right - left);
    let inner2 = left + GOLDEN * (right - left);
    let distance1 = distanceAt(inner1);
    let distance2 = distanceAt(inner2);

    for (let step = 0; step < REFINE_STEPS; step += 1) {
      if (distance1 < distance2) {
        right = inner2;
        inner2 = inner1;
        distance2 = distance1;
        inner1 = right - GOLDEN * (right - left);
        distance1 = distanceAt(inner1);
      } else {
        left = inner1;
        inner1 = inner2;
        distance1 = distance2;
        inner2 = left + GOLDEN * (right - left);
        distance2 = distanceAt(inner2);
      }
    }

    const found = (left + right) / 2;
    if (looping) return wrap(found);

    // Jolt stops a body at the end of a path only when the fraction is exactly
    // there, and narrowing lands just short of it, so a body past the end has
    // to be given the end itself.
    const nearest = distanceAt(found);
    if (low === 0 && distanceAt(0) <= nearest) return 0;
    if (high === maxFraction && distanceAt(maxFraction) <= nearest) {
      return maxFraction;
    }
    return found;
  };
};

export type PathSource = Pick<CustomPath, "at" | "maxFraction"> & {
  looping: boolean;
  closest: NonNullable<CustomPath["closest"]>;
};

const checkPoints = (
  points: readonly PathPoint[],
  looping: boolean,
  hook: string,
) => {
  if (points.length < 2) {
    throw new Error(`r3f-jolt: ${hook} needs at least 2 points.`);
  }

  if (looping) {
    const [x, y, z] = points[0].position;
    const [lastX, lastY, lastZ] = points[points.length - 1].position;
    if (x === lastX && y === lastY && z === lastZ) {
      throw new Error(
        `r3f-jolt: ${hook} looping joins the last point back to the first ` +
          "itself, so leave out the repeated point at the end.",
      );
    }
  }
};

/** A normal along the tangent leaves no way to tell up, which Jolt divides by. */
const checkNormals = (source: PathSource, hook: string) => {
  const sample = createSample();
  const samples = Math.ceil(source.maxFraction) * DEGENERATE_SAMPLES;

  for (let step = 0; step <= samples; step += 1) {
    const fraction = (step / samples) * source.maxFraction;
    source.at(fraction, sample);

    const across = sample.tangent.clone().cross(sample.normal).length();
    if (across / (sample.tangent.length() * sample.normal.length()) > 0.01) {
      continue;
    }

    throw new Error(
      `r3f-jolt: ${hook} path's normal runs along its tangent near fraction ` +
        `${fraction.toFixed(2)}. Give the points there a \`normal\` across the path.`,
    );
  }
};

export const resolvePathSource = (
  points: readonly PathPoint[] | undefined,
  looping: boolean,
  custom: CustomPath | undefined,
  hook: string,
): PathSource => {
  if (custom) {
    const customLooping = custom.looping ?? false;
    return {
      at: custom.at,
      maxFraction: custom.maxFraction,
      looping: customLooping,
      closest:
        custom.closest ??
        createNearest(
          custom.at,
          custom.maxFraction,
          customLooping,
          custom.maxFraction,
        ),
    };
  }

  if (!points) {
    throw new Error(`r3f-jolt: ${hook} needs \`points\` or \`path\`.`);
  }

  checkPoints(points, looping, hook);

  const at = hermiteAt(buildKnots(points, looping), looping);
  const maxFraction = looping ? points.length : points.length - 1;
  const source: PathSource = {
    at,
    maxFraction,
    looping,
    closest: createNearest(at, maxFraction, looping, POINTS_REACH),
  };

  checkNormals(source, hook);
  return source;
};

/** The world or path-space line of a path, for a rail, a track, a debug overlay. */
export const samplePath = (
  source: {
    points?: readonly PathPoint[];
    looping?: boolean;
    path?: CustomPath;
  },
  perFraction = 16,
): Vector3[] => {
  const resolved = resolvePathSource(
    source.points,
    source.looping ?? false,
    source.path,
    "samplePath",
  );
  const sample = createSample();
  const count = Math.ceil(resolved.maxFraction * perFraction);

  return Array.from({ length: count + 1 }, (_, step) => {
    resolved.at((step / count) * resolved.maxFraction, sample);
    return sample.position.clone();
  });
};

/**
 * The Jolt side of a path. Nothing here may allocate through Jolt: it runs in
 * the solver, several times a step for each joint on it.
 */
export const createJoltPath = (jolt: JoltModule, source: PathSource) => {
  const path = new jolt.PathConstraintPathJS();
  const sample = createSample();
  const query = new Vector3();
  const binormal = new Vector3();
  const normal = new Vector3();

  path.SetIsLooping(source.looping);

  path.GetPathMaxFraction = function pathMaxFraction() {
    return source.maxFraction;
  };

  path.GetClosestPoint = function closestPoint(
    inPosition: number,
    inFractionHint: number,
  ) {
    const position = jolt.wrapPointer(inPosition, jolt.Vec3);
    query.set(position.GetX(), position.GetY(), position.GetZ());
    return source.closest(query, inFractionHint);
  };

  path.GetPointOnPath = function pointOnPath(
    inFraction: number,
    outPosition: number,
    outTangent: number,
    outNormal: number,
    outBinormal: number,
  ) {
    source.at(inFraction, sample);
    const tangent = sample.tangent.normalize();

    binormal.crossVectors(sample.normal, tangent).normalize();
    normal.crossVectors(tangent, binormal);

    const { x, y, z } = sample.position;
    jolt.wrapPointer(outPosition, jolt.Vec3).Set(x, y, z);
    jolt.wrapPointer(outTangent, jolt.Vec3).Set(tangent.x, tangent.y, tangent.z);
    jolt.wrapPointer(outNormal, jolt.Vec3).Set(normal.x, normal.y, normal.z);
    jolt
      .wrapPointer(outBinormal, jolt.Vec3)
      .Set(binormal.x, binormal.y, binormal.z);
  };

  return path as Jolt.PathConstraintPath;
};
