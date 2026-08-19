import { PlaneGeometry, Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import {
  shapeFromResultAs,
  useBody,
  type BodyApiContext,
  type BodyOptions,
} from "./internal/useBody";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import {
  createShapeMaterialApi,
  type ShapeMaterialApi,
} from "./internal/shapeMaterial";
import type { Vec3Tuple } from "./types";

export interface UsePlaneOptions extends BodyOptions {
  /** Which way is up, in body-local space. Defaults to +Y. */
  normal?: Vec3Tuple;
  /**
   * The plane is every point where `dot(normal, x) + constant` is zero, so a
   * surface one unit **above** the body's origin has a constant of `-1`. Use
   * `point` instead if that is the wrong way round for you.
   */
  constant?: number;
  /** A point the plane passes through. Overrides `constant` when given. */
  point?: Vec3Tuple;
  /**
   * How far the collider actually reaches from the plane's origin. Jolt's plane
   * is **not** infinite — it is a box-bounded half space, and Jolt's own default
   * of 1000 puts a two-kilometre quad into every debug overlay. 100 here is a
   * scene, not a planet; raise it for a world that needs one.
   */
  halfExtent?: number;
  /** Side length of the mesh handed back as `api.geometry`. */
  renderSize?: number;
  /** Quads per side on that mesh. One is enough unless you are displacing it. */
  renderSegments?: number;
}

export type PlaneApi = ShapeMaterialApi;

const FORWARD = new Vector3(0, 0, 1);

/**
 * Baked into the geometry rather than a wrapper `Object3D`, so the mesh the
 * consumer puts the hook's ref on needs no transform of its own and the body's
 * position and rotation still apply on top.
 */
const planeGeometry = (
  normal: Vec3Tuple,
  constant: number,
  size: number,
  segments: number,
) => {
  const geometry = new PlaneGeometry(size, size, segments, segments);
  const direction = new Vector3(normal[0], normal[1], normal[2]).normalize();

  geometry.applyQuaternion(
    new Quaternion().setFromUnitVectors(FORWARD, direction),
  );
  geometry.translate(
    direction.x * -constant,
    direction.y * -constant,
    direction.z * -constant,
  );

  return geometry;
};

export const usePlane = (options: UsePlaneOptions) => {
  const {
    normal = [0, 1, 0],
    constant = 0,
    point,
    halfExtent = 100,
    renderSize = 20,
    renderSegments = 1,
  } = options;

  return useBody<Jolt.PlaneShape, PlaneApi>(
    (jolt) => {
      // `constant` only means a distance once the normal is unit length, and
      // Jolt asserts if it is not.
      const length =
        Math.hypot(normal[0], normal[1], normal[2]) || 1;
      const direction = new jolt.Vec3(
        normal[0] / length,
        normal[1] / length,
        normal[2] / length,
      );

      let plane: Jolt.Plane;

      if (point) {
        const through = new jolt.Vec3(point[0], point[1], point[2]);
        // A static temporary, so it is copied into a plane of our own before
        // anything else can claim the slot.
        const derived = jolt.Plane.prototype.sFromPointAndNormal(
          through,
          direction,
        );
        plane = new jolt.Plane(derived.GetNormal(), derived.GetConstant());
        jolt.destroy(through);
      } else {
        plane = new jolt.Plane(direction, constant);
      }

      const resolvedConstant = plane.GetConstant();

      const settings = new jolt.PlaneShapeSettings(plane);
      // The constructor's `inHalfExtent` argument is silently dropped when no
      // material is passed — measured. Only the field takes.
      settings.mHalfExtent = halfExtent;

      const result = settings.Create();
      jolt.destroy(settings);
      jolt.destroy(plane);
      jolt.destroy(direction);

      const shape = shapeFromResultAs(jolt, result, jolt.PlaneShape, "usePlane");

      return {
        shape,
        geometry: planeGeometry(
          normal,
          resolvedConstant,
          renderSize,
          renderSegments,
        ),
        // The collider runs out to `halfExtent` while the mesh stops at
        // `renderSize`, and debug is what shows the difference.
        debugGeometry: () => shapeToGeometry(jolt, shape),
      };
    },
    options,
    "plane",
    ({ jolt, shape }: BodyApiContext<Jolt.PlaneShape>) =>
      createShapeMaterialApi(jolt, shape),
  );
};
