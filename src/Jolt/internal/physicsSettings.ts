import type Jolt from "jolt-physics";

/**
 * The `PhysicsSettings` fields worth naming, mapped to Jolt's own spelling. A
 * prop per field would be thirty near-identical assignments; one table keeps
 * the public type, the apply loop and the docs from drifting apart, and adding
 * a field later is one line.
 *
 * Everything not listed keeps whatever the world was built with — the settings
 * are read back from the system before the subset is written, so an unset
 * option is Jolt's default rather than zero.
 */
const PHYSICS_SETTING_FIELDS = {
  maxInFlightBodyPairs: "mMaxInFlightBodyPairs",
  stepListenersBatchSize: "mStepListenersBatchSize",
  stepListenerBatchesPerJob: "mStepListenerBatchesPerJob",
  baumgarte: "mBaumgarte",
  speculativeContactDistance: "mSpeculativeContactDistance",
  penetrationSlop: "mPenetrationSlop",
  linearCastThreshold: "mLinearCastThreshold",
  linearCastMaxPenetration: "mLinearCastMaxPenetration",
  manifoldTolerance: "mManifoldTolerance",
  maxPenetrationDistance: "mMaxPenetrationDistance",
  numVelocitySteps: "mNumVelocitySteps",
  numPositionSteps: "mNumPositionSteps",
  minVelocityForRestitution: "mMinVelocityForRestitution",
  timeBeforeSleep: "mTimeBeforeSleep",
  pointVelocitySleepThreshold: "mPointVelocitySleepThreshold",
  deterministicSimulation: "mDeterministicSimulation",
  constraintWarmStart: "mConstraintWarmStart",
  useBodyPairContactCache: "mUseBodyPairContactCache",
  useManifoldReduction: "mUseManifoldReduction",
  useLargeIslandSplitter: "mUseLargeIslandSplitter",
  allowSleeping: "mAllowSleeping",
  checkActiveEdges: "mCheckActiveEdges",
} as const;

type FieldName = keyof typeof PHYSICS_SETTING_FIELDS;

type FieldValue<K extends FieldName> =
  Jolt.PhysicsSettings[(typeof PHYSICS_SETTING_FIELDS)[K]];

/** Solver and sleep settings, applied over whatever the world already has. */
export type PhysicsSettingsOptions = {
  [K in FieldName]?: FieldValue<K>;
};

const fieldNames = Object.keys(PHYSICS_SETTING_FIELDS) as FieldName[];

export const sameSettings = (
  a: PhysicsSettingsOptions | undefined,
  b: PhysicsSettingsOptions | undefined,
) => {
  if (a === b) return true;
  if (!a || !b) return false;

  return fieldNames.every((name) => a[name] === b[name]);
};

/**
 * Read, write the supplied subset, hand the whole struct back. Mutating in
 * place is not enough on its own — `SetPhysicsSettings` is what makes the
 * change take, and the order is required rather than defensive.
 *
 * The struct is **borrowed**, not ours: two hundred applications leave the heap
 * exactly flat (`tests/leaks.test.tsx`), so destroying it would be a double
 * free rather than the tidy-up it looks like.
 */
export const applyPhysicsSettings = (
  physicsSystem: Jolt.PhysicsSystem,
  options: PhysicsSettingsOptions,
) => {
  const settings = physicsSystem.GetPhysicsSettings();

  for (const name of fieldNames) {
    const value = options[name];
    if (value === undefined) continue;

    // The mapped type proves each pair matches; the loop erases that, and one
    // cast here beats twenty-two hand-written assignments.
    (settings as unknown as Record<string, number | boolean>)[
      PHYSICS_SETTING_FIELDS[name]
    ] = value;
  }

  physicsSystem.SetPhysicsSettings(settings);
};
