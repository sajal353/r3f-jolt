import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleGeometry,
  Mesh,
  Quaternion,
  Vector3,
  BufferGeometry,
} from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import {
  createCharacterListener,
  type CharacterContactHandlers,
} from "./internal/characterContacts";
import {
  createChildShape,
  createColliderShape,
  type CompoundChild,
} from "./internal/colliderShape";
import {
  createDebugMaterial,
  disposeDebugMaterial,
} from "./internal/debugMaterial";
import {
  createDebugView,
  useDebugFlag,
  useDebugView,
  type DebugView,
} from "./internal/debugView";
import { shapeToGeometry } from "./internal/shapeToGeometry";
import { shapeFromResult } from "./internal/useBody";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { JoltModule, QuatTuple, Vec3Tuple } from "./types";

const degreesToRadians = (degrees: number) => degrees * (Math.PI / 180);

export interface CharacterShapeOptions {
  height: { standing: number; crouching: number };
  radius: { standing: number; crouching: number };
  moveDuringJump: boolean;
  moveSpeed: number;
  crouchMoveSpeedRatio: number;
  jumpSpeed: number;
  enableInertia: boolean;
  enableStairStep: boolean;
  enableStickToFloor: boolean;
  maxSlopeAngle: number;
  maxStrength: number;
  characterPadding: number;
  penetrationRecoverySpeed: number;
  predictiveContactDistance: number;
  /** Stops the character catching on the inner edges of a triangle mesh. Costs more per contact. */
  enhancedInternalEdgeRemoval: boolean;
}

export const defaultCharacterOptions: CharacterShapeOptions = {
  height: { standing: 2, crouching: 1 },
  radius: { standing: 1, crouching: 0.8 },
  moveDuringJump: true,
  moveSpeed: 6,
  crouchMoveSpeedRatio: 0.5,
  jumpSpeed: 15,
  enableInertia: true,
  enableStairStep: true,
  enableStickToFloor: true,
  maxSlopeAngle: degreesToRadians(45),
  maxStrength: 100,
  characterPadding: 0.02,
  penetrationRecoverySpeed: 1,
  predictiveContactDistance: 0.1,
  enhancedInternalEdgeRemoval: false,
};

export interface CharacterUpdateOptions {
  ignoreHorizontalMovementLock?: boolean;
  addToVelocity?: Vector3;
  overrideUpdate?: (
    velocity: Vector3,
    up: Vector3,
    deltaTime: number,
  ) => Vector3;
}

/**
 * Shapes placed from the feet, for a character that is not a capsule. One child
 * is used as it is; several make a compound. Without `crouching`, crouching
 * keeps the standing shape.
 */
export interface CharacterShapes {
  standing: CompoundChild[];
  crouching?: CompoundChild[];
}

export interface UseCharacterOptions extends CharacterContactHandlers {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  up?: Vec3Tuple;
  debug?: boolean;
  mass?: number;
  layer?: number;
  /** Read back from `character.GetUserData()`, and from contacts other characters report. */
  userData?: number;
  /** Replaces the capsules that `options.height` and `options.radius` describe. */
  shape?: CharacterShapes;
  /**
   * A kinematic body that follows the character, so bodies and raycasts hit
   * it. `true` uses the character's own shape. Off by default: without it,
   * dynamic bodies pass through the character.
   */
  innerBody?: boolean | CharacterShapes;
  /** Defaults to `layer`. */
  innerBodyLayer?: number;
  /** A fixed `GetIndexAndSequenceNumber()` for the inner body, so a client and a server agree on it. */
  innerBodyIDOverride?: number;
  /** Blocks and is blocked by every other character that has it on. On by default. */
  collideWithCharacters?: boolean;
  /**
   * Off by default: the character walks through cloth, and its `innerBody`, if
   * it has one, is what pushes the cloth aside. Jolt's character queries
   * against a soft body report contacts well short of it, so a character
   * colliding with one stops a metre away.
   */
  collideWithSoftBodies?: boolean;
  options?: Partial<CharacterShapeOptions>;
}

/** One of `getActiveContacts()`: a copy, safe to keep until the next call. */
export interface CharacterActiveContact {
  /** Null when the contact is with another character. */
  bodyID: number | null;
  /** Null when the contact is with a body. */
  characterID: number | null;
  userData: number;
  subShapeID: number;
  point: Vector3;
  /** From the character towards what it touches, as in the contact callbacks. */
  normal: Vector3;
  /** The touched surface's own normal, facing out of it. */
  surfaceNormal: Vector3;
  /** Of the touched surface, at the contact. */
  linearVelocity: Vector3;
  distance: number;
  fraction: number;
  isSensor: boolean;
  hadCollision: boolean;
  wasDiscarded: boolean;
  canPushCharacter: boolean;
}

export interface CharacterApi {
  character: Jolt.CharacterVirtual;
  /** `GetID().GetValue()`: what other characters' contacts report it as. */
  characterID: number;
  /** Null without `innerBody`. */
  innerBodyID: Jolt.BodyID | null;
  /** Touched this body during the last `update`. */
  hasCollidedWith: (body: Jolt.BodyID) => boolean;
  /** Touched this character, by api or `characterID`, during the last `update`. */
  hasCollidedWithCharacter: (other: CharacterApi | number) => boolean;
  /** Everything the character is touching, written into `target` and returned. */
  getActiveContacts: (
    target?: CharacterActiveContact[],
  ) => CharacterActiveContact[];
  update: (
    direction: Vector3,
    jump: boolean,
    crouched: boolean,
    deltaTime: number,
    updateOptions?: CharacterUpdateOptions,
  ) => void;
  /**
   * Swaps in a shape of your own, placed from the feet, until called with
   * `null`, which goes back to the standing or crouching shape. Compound
   * children are built and freed by the hook; a Jolt shape stays yours, and the
   * character keeps its own reference while it uses it. False, and nothing
   * changes, when the shape has no room where the character stands.
   *
   * Only contacts near the feet hold a character up, so a shape that does not
   * reach down to them leaves it unsupported on land. `innerShape` replaces the
   * inner body's; with `innerBody: true` the inner body takes `shape` itself.
   */
  setShape: (
    shape: CompoundChild[] | Jolt.Shape | null,
    innerShape?: Jolt.Shape,
  ) => boolean;
  debugMeshStanding: Mesh | null;
  debugMeshCrouching: Mesh | null;
  /** The shape last given to `setShape`. */
  debugMeshCustom: Mesh | null;
}

type Posture = "standing" | "crouching";

type CharacterDebugMeshes = Record<Posture | "custom", Mesh>;

interface BuiltShape {
  shape: Jolt.Shape;
  geometry: BufferGeometry;
}

type ShapeSet = Record<Posture, BuiltShape>;

const POSTURES: Posture[] = ["standing", "crouching"];

/**
 * A Jolt capsule is centred on its own origin, and a CharacterVirtual's
 * position is its feet, so each shape has to be lifted by its *own* half height
 * plus radius. Sharing one offset sinks the shorter shape into the floor by the
 * difference.
 */
const buildCapsule = (
  jolt: JoltModule,
  height: number,
  radius: number,
): BuiltShape => {
  const halfHeight = 0.5 * height;
  const lift = halfHeight + radius;
  const offset = new jolt.Vec3(0, lift, 0);
  const rotation = new jolt.Quat(0, 0, 0, 1);
  const settings = new jolt.RotatedTranslatedShapeSettings(
    offset,
    rotation,
    new jolt.CapsuleShapeSettings(halfHeight, radius),
  );
  const result = settings.Create();
  jolt.destroy(settings);
  jolt.destroy(rotation);
  jolt.destroy(offset);

  return {
    shape: shapeFromResult<Jolt.Shape>(result, "useCharacter"),
    geometry: new CapsuleGeometry(radius, height, 4, 8).translate(0, lift, 0),
  };
};

/** A compound needs two children at least, so a single one is placed on its own. */
const buildChildren = (
  jolt: JoltModule,
  children: CompoundChild[],
): BuiltShape => {
  if (children.length !== 1) {
    return createColliderShape(jolt, { type: "compound", shapes: children });
  }

  const shape = createChildShape(jolt, children[0], "useCharacter");
  return { shape, geometry: shapeToGeometry(jolt, shape) };
};

const buildShapes = (
  jolt: JoltModule,
  shapes: CharacterShapes | undefined,
  options: CharacterShapeOptions,
): ShapeSet => {
  if (!shapes) {
    const { height, radius } = options;
    return {
      standing: buildCapsule(jolt, height.standing, radius.standing),
      crouching: buildCapsule(jolt, height.crouching, radius.crouching),
    };
  }

  const standing = buildChildren(jolt, shapes.standing);
  return {
    standing,
    crouching: shapes.crouching
      ? buildChildren(jolt, shapes.crouching)
      : standing,
  };
};

/** Without `crouching` both postures share one shape, which is freed once. */
const releaseShapes = (set: ShapeSet) => {
  for (const built of new Set(Object.values(set))) built.shape.Release();
};

const disposeGeometries = (set: ShapeSet) => {
  for (const built of new Set(Object.values(set))) built.geometry.dispose();
};

const INVALID_ID = 0xffffffff;

const activeContact = (): CharacterActiveContact => ({
  bodyID: null,
  characterID: null,
  userData: 0,
  subShapeID: 0,
  point: new Vector3(),
  normal: new Vector3(),
  surfaceNormal: new Vector3(),
  linearVelocity: new Vector3(),
  distance: 0,
  fraction: 0,
  isSensor: false,
  hadCollision: false,
  wasDiscarded: false,
  canPushCharacter: false,
});

const readContact = (
  target: CharacterActiveContact,
  contact: Jolt.CharacterVirtualContact,
) => {
  const bodyID = contact.mBodyB.GetIndexAndSequenceNumber();
  const characterID = contact.mCharacterIDB;
  target.bodyID = bodyID >>> 0 === INVALID_ID ? null : bodyID;
  target.characterID = characterID.IsInvalid() ? null : characterID.GetValue();
  target.userData = contact.mUserData;
  target.subShapeID = contact.mSubShapeIDB.GetValue();

  const point = contact.mPosition;
  target.point.set(point.GetX(), point.GetY(), point.GetZ());
  const normal = contact.mContactNormal;
  target.normal.set(-normal.GetX(), -normal.GetY(), -normal.GetZ());
  const surfaceNormal = contact.mSurfaceNormal;
  target.surfaceNormal.set(
    surfaceNormal.GetX(),
    surfaceNormal.GetY(),
    surfaceNormal.GetZ(),
  );
  const velocity = contact.mLinearVelocity;
  target.linearVelocity.set(velocity.GetX(), velocity.GetY(), velocity.GetZ());

  target.distance = contact.mDistance;
  target.fraction = contact.mFraction;
  target.isSensor = contact.mIsSensorB;
  target.hadCollision = contact.mHadCollision;
  target.wasDiscarded = contact.mWasDiscarded;
  target.canPushCharacter = contact.mCanPushCharacter;
  return target;
};

const mergeOptions = (
  overrides: Partial<CharacterShapeOptions> | undefined,
): CharacterShapeOptions => ({
  ...defaultCharacterOptions,
  ...overrides,
  height: { ...defaultCharacterOptions.height, ...overrides?.height },
  radius: { ...defaultCharacterOptions.radius, ...overrides?.radius },
});

const skipSoftBodies = (jolt: JoltModule) => {
  const filter = new jolt.BodyFilterJS();
  filter.ShouldCollide = function anyBody() {
    return true;
  };
  filter.ShouldCollideLocked = function notSoft(inBody: number) {
    return !jolt.wrapPointer(inBody, jolt.Body).IsSoftBody();
  };
  return filter;
};

export const useCharacter = (hookOptions: UseCharacterOptions) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);

  const stateRef = useRef({
    shouldSlide: true,
    desiredVelocity: new Vector3(),
    posture: "standing" as Posture,
    custom: false,
  });

  const debugViewRef = useRef<DebugView<CharacterDebugMeshes> | null>(null);
  const [characterApi, setCharacterApi] = useState<CharacterApi>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  // The contact handlers are the exception, and stay live.
  const [mount] = useState(() => hookOptions);
  const handlersRef = useHandlerRef<CharacterContactHandlers>(hookOptions);

  useEffect(() => {
    const {
      Jolt: jolt,
      joltInterface,
      physicsSystem,
      layers,
      contacts,
      characters,
      state,
    } = api;

    const {
      position,
      rotation = [0, 0, 0, 1],
      up = [0, 1, 0],
      mass = 1000,
      layer = layers.LAYER_MOVING,
      userData,
      shape,
      innerBody = false,
      innerBodyLayer = layer,
      innerBodyIDOverride,
      collideWithCharacters = true,
      collideWithSoftBodies = false,
    } = mount;

    const options = mergeOptions(mount.options);
    stateRef.current.posture = "standing";
    stateRef.current.custom = false;

    const broadPhaseFilter = new jolt.DefaultBroadPhaseLayerFilter(
      joltInterface.GetObjectVsBroadPhaseLayerFilter(),
      layer,
    );
    const layerFilter = new jolt.DefaultObjectLayerFilter(
      joltInterface.GetObjectLayerPairFilter(),
      layer,
    );
    const bodyFilter = collideWithSoftBodies
      ? new jolt.BodyFilter()
      : skipSoftBodies(jolt);
    const shapeFilter = new jolt.ShapeFilter();

    const shapes = buildShapes(jolt, shape, options);
    const innerShapes =
      innerBody === true
        ? shapes
        : innerBody
          ? buildShapes(jolt, innerBody, options)
          : null;

    const settings = new jolt.CharacterVirtualSettings();
    settings.mMass = mass;
    settings.mMaxSlopeAngle = options.maxSlopeAngle;
    settings.mMaxStrength = options.maxStrength;
    settings.mShape = shapes.standing.shape;
    settings.mEnhancedInternalEdgeRemoval = options.enhancedInternalEdgeRemoval;
    settings.mBackFaceMode = jolt.EBackFaceMode_CollideWithBackFaces;
    settings.mCharacterPadding = options.characterPadding;
    settings.mPenetrationRecoverySpeed = options.penetrationRecoverySpeed;
    settings.mPredictiveContactDistance = options.predictiveContactDistance;

    if (innerShapes) {
      settings.mInnerBodyShape = innerShapes.standing.shape;
      settings.mInnerBodyLayer = innerBodyLayer;
      if (innerBodyIDOverride !== undefined) {
        const override = new jolt.BodyID(innerBodyIDOverride);
        settings.mInnerBodyIDOverride = override;
        jolt.destroy(override);
      }
    }

    const supportingPlaneNormal = new jolt.Vec3(up[0], up[1], up[2]);
    const supportingVolume = new jolt.Plane(
      supportingPlaneNormal,
      -options.radius.standing,
    );
    settings.mSupportingVolume = supportingVolume;
    jolt.destroy(supportingVolume);
    jolt.destroy(supportingPlaneNormal);

    const startPosition = new jolt.RVec3(position[0], position[1], position[2]);
    const startRotation = new jolt.Quat(
      rotation[0],
      rotation[1],
      rotation[2],
      rotation[3],
    );

    const character = new jolt.CharacterVirtual(
      settings,
      startPosition,
      startRotation,
      physicsSystem,
    );

    const upVector = new jolt.Vec3(up[0], up[1], up[2]);
    character.SetUp(upVector);
    if (userData !== undefined) character.SetUserData(userData);

    if (collideWithCharacters) {
      characters.Add(character);
      character.SetCharacterVsCharacterCollision(characters);
    }

    const characterID = character.GetID().GetValue();
    const innerBodyID = innerShapes
      ? new jolt.BodyID(character.GetInnerBodyID().GetIndexAndSequenceNumber())
      : null;

    const contactListener = createCharacterListener(jolt, {
      handlers: () => handlersRef.current,
      contacts,
      bodyInterface: physicsSystem.GetBodyInterfaceNoLock(),
      shouldSlide: () => stateRef.current.shouldSlide,
    });

    character.SetListener(contactListener);

    const characterUp = new Vector3(up[0], up[1], up[2]).normalize();
    const upRotation = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      characterUp,
    );

    const updateSettings = new jolt.ExtendedUpdateSettings();

    // Jolt switches both of these off with a zero vector, so enabling one means
    // keeping the magnitude it was constructed with and turning it to face
    // along the character's own up axis.
    const alignToUp = (setting: Jolt.Vec3, sign: number) => {
      const length = sign * setting.Length();
      setting.Set(
        characterUp.x * length,
        characterUp.y * length,
        characterUp.z * length,
      );
    };

    if (options.enableStickToFloor) {
      alignToUp(updateSettings.mStickToFloorStepDown, -1);
    } else {
      updateSettings.mStickToFloorStepDown = jolt.Vec3.prototype.sZero();
    }

    if (options.enableStairStep) {
      alignToUp(updateSettings.mWalkStairsStepUp, 1);
    } else {
      updateSettings.mWalkStairsStepUp = jolt.Vec3.prototype.sZero();
    }

    const tempVec3 = new jolt.Vec3();
    const noGravity = new jolt.Vec3(0, 0, 0);
    const weightAt = new jolt.RVec3();
    const weight = new Vector3();
    const bodyInterface = physicsSystem.GetBodyInterfaceNoLock();
    const lockInterface = physicsSystem.GetBodyLockInterfaceNoLock();

    /**
     * Jolt presses the weight in at its single ground contact. On a small light
     * body, a floating crate say, that point tips the body, slides out to the
     * edge and spins it up without end. Pressing under the character's centre
     * keeps the torque to where it actually stands.
     */
    const pressOnGround = (deltaTime: number) => {
      if (character.GetGroundState() !== jolt.EGroundState_OnGround) return;

      const groundID = character.GetGroundBodyID();
      if (groundID.GetIndexAndSequenceNumber() >>> 0 === INVALID_ID) return;
      if (bodyInterface.GetMotionType(groundID) !== jolt.EMotionType_Dynamic) {
        return;
      }

      const at = character.GetPosition();
      const contact = character.GetGroundPosition();
      const drop =
        (contact.GetX() - at.GetX()) * characterUp.x +
        (contact.GetY() - at.GetY()) * characterUp.y +
        (contact.GetZ() - at.GetZ()) * characterUp.z;
      weightAt.Set(
        at.GetX() + characterUp.x * drop,
        at.GetY() + characterUp.y * drop,
        at.GetZ() + characterUp.z * drop,
      );

      const ground = lockInterface.TryGetBody(groundID);
      const groundMass = 1 / ground.GetMotionProperties().GetInverseMass();
      const impulse = Math.min(character.GetMass(), groundMass) * deltaTime;
      tempVec3.Set(weight.x * impulse, weight.y * impulse, weight.z * impulse);
      bodyInterface.AddImpulse(groundID, tempVec3, weightAt);
    };

    let customGeometry = new BufferGeometry();

    const showShape = (meshes: CharacterDebugMeshes | null) => {
      if (!meshes) return;
      const { posture, custom } = stateRef.current;
      meshes.custom.geometry = customGeometry;
      meshes.custom.visible = custom;
      for (const each of POSTURES) {
        meshes[each].visible = !custom && each === posture;
      }
    };

    const buildDebugMeshes = () => {
      const meshes = {
        standing: new Mesh(shapes.standing.geometry),
        crouching: new Mesh(shapes.crouching.geometry),
        custom: new Mesh(customGeometry),
      };
      for (const mesh of Object.values(meshes)) {
        mesh.material = createDebugMaterial("character");
        scene.add(mesh);
      }
      showShape(meshes);
      return meshes;
    };

    const releaseDebugMeshes = (meshes: CharacterDebugMeshes) => {
      for (const mesh of Object.values(meshes)) {
        scene.remove(mesh);
        disposeDebugMaterial(mesh);
      }
    };

    const applyShape = (next: Jolt.Shape) =>
      character.SetShape(
        next,
        1.5 * physicsSystem.GetPhysicsSettings().mPenetrationSlop,
        broadPhaseFilter,
        layerFilter,
        bodyFilter,
        shapeFilter,
        joltInterface.GetTempAllocator(),
      );

    /** Left as it was when the new shape has no room, and tried again next update. */
    const takePosture = (posture: Posture) => {
      if (!applyShape(shapes[posture].shape)) return;

      stateRef.current.posture = posture;
      if (innerShapes) character.SetInnerBodyShape(innerShapes[posture].shape);
      showShape(debugView.current);
    };

    /** The last `setShape` built from compound children, which the hook frees. */
    let ownedCustom: Jolt.Shape | null = null;

    const setShape = (
      next: CompoundChild[] | Jolt.Shape | null,
      innerShape?: Jolt.Shape,
    ) => {
      if (state.destroyed) return false;

      const built = Array.isArray(next) ? buildChildren(jolt, next) : null;
      const custom = built ? built.shape : (next as Jolt.Shape | null);
      const { posture } = stateRef.current;

      if (!applyShape(custom ?? shapes[posture].shape)) {
        if (built) {
          built.shape.Release();
          built.geometry.dispose();
        }
        return false;
      }

      stateRef.current.custom = custom !== null;
      if (innerShapes) {
        const inner = custom
          ? (innerShape ?? (innerShapes === shapes ? custom : null))
          : innerShapes[posture].shape;
        if (inner) character.SetInnerBodyShape(inner);
      }

      ownedCustom?.Release();
      ownedCustom = built ? built.shape : null;

      customGeometry.dispose();
      customGeometry = built
        ? built.geometry
        : custom
          ? shapeToGeometry(jolt, custom)
          : new BufferGeometry();
      showShape(debugView.current);
      return true;
    };

    const debugView = createDebugView(buildDebugMeshes, releaseDebugMeshes);
    debugViewRef.current = debugView;

    const linearVelocity = new Vector3();
    const verticalVelocity = new Vector3();
    const groundVelocity = new Vector3();
    const gravity = new Vector3();
    const newVelocity = new Vector3();
    const scratch = new Vector3();

    const update = (
      direction: Vector3,
      jump: boolean,
      crouched: boolean,
      deltaTime: number,
      updateOptions: CharacterUpdateOptions = {},
    ) => {
      if (state.destroyed) return;

      const {
        ignoreHorizontalMovementLock = false,
        addToVelocity,
        overrideUpdate,
      } = updateOptions;

      // A shape of the caller's own stays until they hand it back.
      const wanted: Posture = crouched ? "crouching" : "standing";
      if (!stateRef.current.custom && wanted !== stateRef.current.posture) {
        takePosture(wanted);
      }
      const isCrouched =
        !stateRef.current.custom && stateRef.current.posture === "crouching";

      const moveSpeed = isCrouched
        ? options.moveSpeed * options.crouchMoveSpeedRatio
        : options.moveSpeed;

      const canMove = options.moveDuringJump || character.IsSupported();

      if (canMove || ignoreHorizontalMovementLock) {
        stateRef.current.shouldSlide = direction.lengthSq() >= 1.0e-24;

        if (options.enableInertia) {
          scratch.copy(direction).multiplyScalar(0.25 * moveSpeed);
          stateRef.current.desiredVelocity.multiplyScalar(0.75).add(scratch);
        } else {
          stateRef.current.desiredVelocity
            .copy(direction)
            .multiplyScalar(moveSpeed);
        }
      } else {
        stateRef.current.shouldSlide = true;
      }

      character.UpdateGroundVelocity();

      const velocity = character.GetLinearVelocity();
      linearVelocity.set(velocity.GetX(), velocity.GetY(), velocity.GetZ());

      verticalVelocity
        .copy(characterUp)
        .multiplyScalar(linearVelocity.dot(characterUp));

      const ground = character.GetGroundVelocity();
      groundVelocity.set(ground.GetX(), ground.GetY(), ground.GetZ());

      const worldGravity = physicsSystem.GetGravity();
      gravity.set(
        worldGravity.GetX(),
        worldGravity.GetY(),
        worldGravity.GetZ(),
      );

      const movingTowardsGround = verticalVelocity.y - groundVelocity.y < 0.1;
      const onGround =
        character.GetGroundState() === jolt.EGroundState_OnGround &&
        (options.enableInertia
          ? movingTowardsGround
          : !character.IsSlopeTooSteep(character.GetGroundNormal()));

      if (onGround) {
        newVelocity.copy(groundVelocity);

        if (jump && movingTowardsGround && !isCrouched) {
          scratch.copy(characterUp).multiplyScalar(options.jumpSpeed);
          newVelocity.add(scratch);
        }
      } else {
        newVelocity.copy(verticalVelocity);
      }

      scratch.copy(gravity).applyQuaternion(upRotation);
      weight.copy(scratch);
      newVelocity.addScaledVector(scratch, deltaTime);

      scratch
        .copy(stateRef.current.desiredVelocity)
        .applyQuaternion(upRotation);
      newVelocity.add(scratch);

      if (addToVelocity) {
        newVelocity.add(addToVelocity);
      }

      const finalVelocity = overrideUpdate
        ? overrideUpdate(newVelocity, characterUp, deltaTime)
        : newVelocity;

      tempVec3.Set(finalVelocity.x, finalVelocity.y, finalVelocity.z);
      character.SetLinearVelocity(tempVec3);

      // Jolt's gravity argument is only the weight the character puts on what
      // it stands on, which `pressOnGround` applies instead.
      character.ExtendedUpdate(
        deltaTime,
        noGravity,
        updateSettings,
        broadPhaseFilter,
        layerFilter,
        bodyFilter,
        shapeFilter,
        joltInterface.GetTempAllocator(),
      );

      pressOnGround(deltaTime);
    };

    // Getters, because the overlay comes and goes with `<Physics debug>`
    // while the api object itself must stay the same.
    const hasCollidedWithCharacter = (other: CharacterApi | number) => {
      if (typeof other !== "number") {
        return character.HasCollidedWithCharacter(other.character);
      }

      const active = character.GetActiveContacts();
      for (let index = 0; index < active.size(); index += 1) {
        const contact = active.at(index);
        if (
          contact.mHadCollision &&
          !contact.mCharacterIDB.IsInvalid() &&
          contact.mCharacterIDB.GetValue() === other
        ) {
          return true;
        }
      }
      return false;
    };

    const getActiveContacts = (target: CharacterActiveContact[] = []) => {
      const active = character.GetActiveContacts();
      const count = active.size();
      for (let index = 0; index < count; index += 1) {
        target[index] ??= activeContact();
        readContact(target[index], active.at(index));
      }
      target.length = count;
      return target;
    };

    setCharacterApi({
      character,
      characterID,
      innerBodyID,
      hasCollidedWith: (body) => character.HasCollidedWith(body),
      hasCollidedWithCharacter,
      getActiveContacts,
      update,
      get debugMeshStanding() {
        return debugView.current?.standing ?? null;
      },
      get debugMeshCrouching() {
        return debugView.current?.crouching ?? null;
      },
      get debugMeshCustom() {
        return debugView.current?.custom ?? null;
      },
      setShape,
    });

    return () => {
      setCharacterApi(undefined);
      debugView.hide();
      debugViewRef.current = null;

      disposeGeometries(shapes);
      if (innerShapes && innerShapes !== shapes) disposeGeometries(innerShapes);
      customGeometry.dispose();

      if (state.destroyed) return;

      if (collideWithCharacters) characters.Remove(character);
      character.SetListener(null as unknown as Jolt.CharacterContactListener);
      jolt.destroy(contactListener);
      jolt.destroy(character);
      jolt.destroy(settings);

      releaseShapes(shapes);
      ownedCustom?.Release();
      if (innerShapes && innerShapes !== shapes) releaseShapes(innerShapes);
      if (innerBodyID) jolt.destroy(innerBodyID);

      jolt.destroy(updateSettings);
      jolt.destroy(tempVec3);
      jolt.destroy(noGravity);
      jolt.destroy(weightAt);
      jolt.destroy(upVector);
      jolt.destroy(startPosition);
      jolt.destroy(startRotation);
      jolt.destroy(shapeFilter);
      jolt.destroy(bodyFilter);
      jolt.destroy(layerFilter);
      jolt.destroy(broadPhaseFilter);
    };
  }, [api, mount, scene, handlersRef]);

  const debug = useDebugFlag(mount.debug);
  useDebugView(characterApi, debugViewRef, debug);

  useFrame(() => {
    if (!characterApi) return;

    const {
      character,
      debugMeshStanding,
      debugMeshCrouching,
      debugMeshCustom,
    } = characterApi;
    const position = character.GetPosition();
    const rotation = character.GetRotation();

    for (const mesh of [
      debugMeshStanding,
      debugMeshCrouching,
      debugMeshCustom,
    ]) {
      if (!mesh || !mesh.visible) continue;
      mesh.position.set(position.GetX(), position.GetY(), position.GetZ());
      mesh.quaternion.set(
        rotation.GetX(),
        rotation.GetY(),
        rotation.GetZ(),
        rotation.GetW(),
      );
    }
  });

  return [characterApi] as [CharacterApi | undefined];
};
