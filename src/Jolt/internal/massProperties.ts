import type Jolt from "jolt-physics";
import type { JoltModule, Vec3Tuple } from "../types";

/**
 * What Jolt works out for itself and what it takes from you.
 *
 * - `calculateMassAndInertia` — Jolt's default: both come from the shape's
 *   volume and density.
 * - `calculateInertia` — you give the mass, Jolt scales the shape's inertia to
 *   match it. The same thing the scalar `mass` option does.
 * - `massAndInertiaProvided` — both are yours. The only way to make a body
 *   resist rotation differently from how its shape says it should.
 */
export type MassPropertiesOverride =
  | "calculateMassAndInertia"
  | "calculateInertia"
  | "massAndInertiaProvided";

export interface MassPropertiesOptions {
  /** Kilograms. */
  mass?: number;
  /**
   * The diagonal of the inertia tensor about the centre of mass, in kg·m².
   *
   * Jolt stores a full tensor but hands it back eigen-decomposed into a
   * diagonal plus a rotation, and the diagonal comes out sorted — so the three
   * numbers survive a round trip while their order does not.
   */
  inertia?: Vec3Tuple;
}

const MODES = {
  calculateMassAndInertia: "EOverrideMassProperties_CalculateMassAndInertia",
  calculateInertia: "EOverrideMassProperties_CalculateInertia",
  massAndInertiaProvided: "EOverrideMassProperties_MassAndInertiaProvided",
} as const satisfies Record<MassPropertiesOverride, string>;

/** The narrowest mode covering what was supplied, so the common cases need no
 *  mode at all. */
const resolveMode = (
  options: MassPropertiesOptions,
  explicit: MassPropertiesOverride | undefined,
): MassPropertiesOverride | undefined => {
  if (explicit) return explicit;
  if (options.inertia) return "massAndInertiaProvided";
  if (options.mass !== undefined) return "calculateInertia";
  return undefined;
};

/**
 * Jolt has no centre-of-mass override — that comes from the shape, so shifting
 * it means building a compound whose child sits off-centre. Only mass and
 * inertia are settable here, and `MassProperties` binds nothing else.
 */
export const applyMassProperties = (
  jolt: JoltModule,
  settings: Jolt.BodyCreationSettings,
  options: MassPropertiesOptions,
  explicit: MassPropertiesOverride | undefined,
) => {
  const mode = resolveMode(options, explicit);

  if (mode === undefined) return;

  settings.mOverrideMassProperties = jolt[MODES[mode]];

  if (mode === "calculateMassAndInertia") return;

  const { mass, inertia } = options;

  if (mass === undefined || mass <= 0) {
    throw new Error(
      `[r3f-jolt] massProperties: "${mode}" needs a positive \`mass\`. ` +
        `Received ${mass}, which Jolt rejects with an assert.`,
    );
  }

  if (mode === "massAndInertiaProvided" && !inertia) {
    throw new Error(
      '[r3f-jolt] massProperties: "massAndInertiaProvided" needs an `inertia` ' +
        "diagonal as well as a `mass`. Drop to `calculateInertia` to have Jolt " +
        "derive the inertia from the shape.",
    );
  }

  const properties = new jolt.MassProperties();
  properties.mMass = mass;

  if (inertia) {
    const diagonal = new jolt.Vec3(inertia[0], inertia[1], inertia[2]);
    properties.mInertia = jolt.Mat44.prototype.sScaleVec3(diagonal);
    jolt.destroy(diagonal);
  }

  // Copies into the settings' own storage, so nothing here outlives the call.
  settings.mMassPropertiesOverride = properties;
  jolt.destroy(properties);
};
