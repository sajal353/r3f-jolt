export { Physics, type PhysicsProps } from "@/Jolt/Physics";
export { PhysicsDebug, type PhysicsDebugProps } from "@/Jolt/PhysicsDebug";
export { useJolt } from "@/Jolt/useJolt";

export { useBox, type UseBoxOptions } from "@/Jolt/useBox";
export { useSphere, type UseSphereOptions } from "@/Jolt/useSphere";
export { useCapsule, type UseCapsuleOptions } from "@/Jolt/useCapsule";
export { useCylinder, type UseCylinderOptions } from "@/Jolt/useCylinder";
export {
  useTaperedCapsule,
  type UseTaperedCapsuleOptions,
} from "@/Jolt/useTaperedCapsule";
export {
  useConvex,
  type UseConvexOptions,
  type ConvexApi,
} from "@/Jolt/useConvex";
export {
  useCompound,
  type UseCompoundOptions,
  type CompoundChild,
} from "@/Jolt/useCompound";
export {
  useTrimesh,
  type UseTrimeshOptions,
  type TrimeshSource,
  type TrimeshBuildQuality,
  type TrimeshExtras,
} from "@/Jolt/useTrimesh";
export { usePlane, type UsePlaneOptions, type PlaneApi } from "@/Jolt/usePlane";
export {
  useHeightField,
  type UseHeightFieldOptions,
  type HeightFieldExtras,
  type HeightFieldSamples,
  type HeightFieldSampler,
  type HeightFieldImage,
} from "@/Jolt/useHeightField";
export {
  useTaperedCylinder,
  type UseTaperedCylinderOptions,
} from "@/Jolt/useTaperedCylinder";
export { useEmpty, type UseEmptyOptions } from "@/Jolt/useEmpty";
export type { ShapeMaterialApi } from "@/Jolt/internal/shapeMaterial";

export {
  useCharacter,
  defaultCharacterOptions,
  type UseCharacterOptions,
  type CharacterApi,
  type CharacterShapeOptions,
  type CharacterUpdateOptions,
} from "@/Jolt/useCharacter";

export {
  useCar,
  type UseCarOptions,
  type CarApi,
  type CarInput,
  type CarState,
  type CarWheelState,
} from "@/Jolt/useCar";

export {
  useClosestHitRaycaster,
  type UseClosestHitRaycasterOptions,
  type ClosestHitRaycasterApi,
  type RaycastHit,
} from "@/Jolt/useClosestHitRaycaster";

export {
  useAnyHitRaycaster,
  type UseAnyHitRaycasterOptions,
  type AnyHitRaycasterApi,
} from "@/Jolt/useAnyHitRaycaster";

export {
  useAllHitsRaycaster,
  type UseAllHitsRaycasterOptions,
  type AllHitsRaycasterApi,
} from "@/Jolt/useAllHitsRaycaster";

export type { RaycasterOptions } from "@/Jolt/internal/raycast";

export {
  useShapeCaster,
  type UseShapeCasterOptions,
  type ShapeCasterApi,
} from "@/Jolt/useShapeCaster";
export {
  useShapeOverlap,
  type UseShapeOverlapOptions,
  type ShapeOverlapApi,
} from "@/Jolt/useShapeOverlap";
export {
  usePointQuery,
  type UsePointQueryOptions,
  type PointQueryApi,
  type PointHit,
} from "@/Jolt/usePointQuery";
export {
  useBroadphaseQuery,
  type UseBroadphaseQueryOptions,
  type BroadphaseQueryApi,
} from "@/Jolt/useBroadphaseQuery";

export {
  overlapsAABox,
  overlapsOrientedBox,
  type AABoxInput,
  type OrientedBoxInput,
} from "@/Jolt/boxOverlap";

export type {
  QueryBody,
  QueryMode,
  QueryFilterOptions,
  OverlapHit,
  ShapeCastHit,
} from "@/Jolt/internal/query";

export {
  useFixedConstraint,
  type UseFixedConstraintOptions,
  type FixedConstraintApi,
} from "@/Jolt/useFixedConstraint";
export {
  usePointConstraint,
  type UsePointConstraintOptions,
  type PointConstraintApi,
} from "@/Jolt/usePointConstraint";
export {
  useHingeConstraint,
  type UseHingeConstraintOptions,
  type HingeConstraintApi,
  type HingeConstraintExtras,
} from "@/Jolt/useHingeConstraint";
export {
  useSliderConstraint,
  type UseSliderConstraintOptions,
  type SliderConstraintApi,
  type SliderConstraintExtras,
} from "@/Jolt/useSliderConstraint";
export {
  useDistanceConstraint,
  type UseDistanceConstraintOptions,
  type DistanceConstraintApi,
  type DistanceConstraintExtras,
} from "@/Jolt/useDistanceConstraint";
export {
  useConeConstraint,
  type UseConeConstraintOptions,
  type ConeConstraintApi,
  type ConeConstraintExtras,
} from "@/Jolt/useConeConstraint";
export {
  useSwingTwistConstraint,
  type UseSwingTwistConstraintOptions,
  type SwingTwistConstraintApi,
  type SwingTwistConstraintExtras,
  type SwingType,
} from "@/Jolt/useSwingTwistConstraint";
export {
  useSixDOFConstraint,
  type UseSixDOFConstraintOptions,
  type SixDOFConstraintApi,
  type SixDOFConstraintExtras,
  type SixDOFAxis,
  type SixDOFAxisOptions,
} from "@/Jolt/useSixDOFConstraint";

export type {
  ConstraintApi,
  ConstraintApiContext,
  ConstraintBody,
  ConstraintOptions,
} from "@/Jolt/internal/useConstraint";
export type {
  ConstraintSpace,
  MotorState,
  MotorLimits,
  AngularMotorOptions,
  LinearMotorOptions,
  SpringOptions,
  LimitOptions,
} from "@/Jolt/internal/constraintSettings";

export { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
export { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
export type { PhysicsSettingsOptions } from "@/Jolt/internal/physicsSettings";

export { useContactListener } from "@/Jolt/useContactListener";
export { useBodyContacts } from "@/Jolt/useBodyContacts";
export {
  useConveyor,
  type UseConveyorOptions,
  type ConveyorApi,
} from "@/Jolt/useConveyor";

export type {
  BodyOptions,
  BodyApi,
  BodyApiContext,
} from "@/Jolt/internal/useBody";
export type {
  MassPropertiesOptions,
  MassPropertiesOverride,
} from "@/Jolt/internal/massProperties";

/**
 * Triangulates any Jolt shape. The body hooks hand this back as `api.geometry`;
 * it is exported for the case where you are not using one — instancing a few
 * thousand bodies through `useJolt()`, where a tapered capsule, a hull or a
 * compound has no equivalent primitive in three to draw it with.
 */
export {
  shapeToGeometry,
  refillShapeGeometry,
} from "@/Jolt/internal/shapeToGeometry";
export {
  debugColors,
  debugMotionColors,
  type DebugShapeKind,
} from "@/Jolt/internal/debugMaterial";

export type {
  JoltApi,
  JoltModule,
  JoltInit,
  Vec3Tuple,
  QuatTuple,
  Vec3Input,
  QuatInput,
  AxisTriple,
  Temps,
  MotionType,
  PhysicsTiming,
  BodyMaterial,
  BroadPhaseLayerConfig,
  LayerConfig,
  ContactHandlers,
  ContactInfo,
  ContactRegistry,
  SurfaceVelocity,
  SurfaceVelocityHandle,
  BodyContactHandlers,
  ActivationHandlers,
  ActivationRegistry,
  StepCallback,
  StepPhase,
  StepRegistry,
} from "@/Jolt/types";
