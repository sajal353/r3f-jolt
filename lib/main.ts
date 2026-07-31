export { Physics, type PhysicsProps } from "@/Jolt/Physics";
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

export { useContactListener } from "@/Jolt/useContactListener";
export { useBodyContacts } from "@/Jolt/useBodyContacts";

export type { BodyOptions, BodyApi } from "@/Jolt/internal/useBody";
export { debugColors, type DebugShapeKind } from "@/Jolt/internal/debugMaterial";

export type {
  JoltApi,
  JoltModule,
  JoltInit,
  Vec3Tuple,
  QuatTuple,
  MotionType,
  BodyMaterial,
  BroadPhaseLayerConfig,
  LayerConfig,
  ContactHandlers,
  ContactInfo,
  ContactRegistry,
  BodyContactHandlers,
} from "@/Jolt/types";
