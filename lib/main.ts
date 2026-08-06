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
export { useConvex, type UseConvexOptions } from "@/Jolt/useConvex";
export {
  useCompound,
  type UseCompoundOptions,
  type CompoundChild,
} from "@/Jolt/useCompound";
export {
  useTrimesh,
  type UseTrimeshOptions,
  type TrimeshSource,
} from "@/Jolt/useTrimesh";

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

export { useContactListener } from "@/Jolt/useContactListener";
export { useBodyContacts } from "@/Jolt/useBodyContacts";
export {
  useConveyor,
  type UseConveyorOptions,
  type ConveyorApi,
} from "@/Jolt/useConveyor";

export type { BodyOptions, BodyApi } from "@/Jolt/internal/useBody";

/**
 * Triangulates any Jolt shape. The body hooks hand this back as `api.geometry`;
 * it is exported for the case where you are not using one — instancing a few
 * thousand bodies through `useJolt()`, where a tapered capsule, a hull or a
 * compound has no equivalent primitive in three to draw it with.
 */
export { shapeToGeometry } from "@/Jolt/internal/shapeToGeometry";
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
} from "@/Jolt/types";
