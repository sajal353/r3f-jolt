import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleGeometry, Mesh, Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { createDebugMaterial, disposeDebugMaterial } from "./internal/debugMaterial";
import { finishShape } from "./internal/useBody";
import type { QuatTuple, Vec3Tuple } from "./types";

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
};

export interface CharacterUpdateOptions {
  ignoreHorizontalMovementLock?: boolean;
  addToVelocity?: Vector3;
  overrideUpdate?: (velocity: Vector3, up: Vector3) => Vector3;
}

export interface UseCharacterOptions {
  position: Vec3Tuple;
  rotation?: QuatTuple;
  up?: Vec3Tuple;
  debug?: boolean;
  mass?: number;
  layer?: number;
  options?: Partial<CharacterShapeOptions>;
}

export interface CharacterApi {
  character: Jolt.CharacterVirtual;
  update: (
    direction: Vector3,
    jump: boolean,
    crouched: boolean,
    deltaTime: number,
    updateOptions?: CharacterUpdateOptions,
  ) => void;
  debugMeshStanding: Mesh | null;
  debugMeshCrouching: Mesh | null;
}

const mergeOptions = (
  overrides: Partial<CharacterShapeOptions> | undefined,
): CharacterShapeOptions => ({
  ...defaultCharacterOptions,
  ...overrides,
  height: { ...defaultCharacterOptions.height, ...overrides?.height },
  radius: { ...defaultCharacterOptions.radius, ...overrides?.radius },
});

export const useCharacter = (hookOptions: UseCharacterOptions) => {
  const api = useJolt();
  const scene = useThree((state) => state.scene);

  const stateRef = useRef({
    shouldSlide: true,
    desiredVelocity: new Vector3(),
    crouched: false,
  });

  const [characterApi, setCharacterApi] = useState<CharacterApi>();

  // Init-once, like the body hooks: snapshot at mount, rebuild with `key`.
  const [mount] = useState(() => hookOptions);

  useEffect(() => {
    const {
      Jolt: jolt,
      joltInterface,
      physicsSystem,
      layers,
      state,
      debug: debugDefault,
    } = api;

    const {
      position,
      rotation = [0, 0, 0, 1],
      up = [0, 1, 0],
      debug = debugDefault,
      mass = 1000,
      layer = layers.LAYER_MOVING,
    } = mount;

    const options = mergeOptions(mount.options);

    const broadPhaseFilter = new jolt.DefaultBroadPhaseLayerFilter(
      joltInterface.GetObjectVsBroadPhaseLayerFilter(),
      layer,
    );
    const layerFilter = new jolt.DefaultObjectLayerFilter(
      joltInterface.GetObjectLayerPairFilter(),
      layer,
    );
    const bodyFilter = new jolt.BodyFilter();
    const shapeFilter = new jolt.ShapeFilter();

    const shapeRotation = new jolt.Quat(0, 0, 0, 1);

    // A Jolt capsule is centred on its own origin, and a CharacterVirtual's
    // position is its feet, so each shape has to be lifted by its *own* half
    // height plus radius. Sharing one offset sinks the shorter shape into the
    // floor by the difference.
    const buildShape = (halfHeight: number, radius: number) => {
      const offset = new jolt.Vec3(0, halfHeight + radius, 0);
      const settings = new jolt.RotatedTranslatedShapeSettings(
        offset,
        shapeRotation,
        new jolt.CapsuleShapeSettings(halfHeight, radius),
      );
      const result = settings.Create();
      const shape = finishShape(result.Get());
      result.Clear();
      jolt.destroy(settings);
      jolt.destroy(offset);
      return shape;
    };

    const standingShape = buildShape(
      0.5 * options.height.standing,
      options.radius.standing,
    );
    const crouchingShape = buildShape(
      0.5 * options.height.crouching,
      options.radius.crouching,
    );

    const standingGeometry = new CapsuleGeometry(
      options.radius.standing,
      options.height.standing,
      4,
      8,
    ).translate(0, 0.5 * options.height.standing + options.radius.standing, 0);

    const crouchingGeometry = new CapsuleGeometry(
      options.radius.crouching,
      options.height.crouching,
      4,
      8,
    ).translate(
      0,
      0.5 * options.height.crouching + options.radius.crouching,
      0,
    );

    const settings = new jolt.CharacterVirtualSettings();
    settings.mMass = mass;
    settings.mMaxSlopeAngle = options.maxSlopeAngle;
    settings.mMaxStrength = options.maxStrength;
    settings.mShape = standingShape;
    settings.mBackFaceMode = jolt.EBackFaceMode_CollideWithBackFaces;
    settings.mCharacterPadding = options.characterPadding;
    settings.mPenetrationRecoverySpeed = options.penetrationRecoverySpeed;
    settings.mPredictiveContactDistance = options.predictiveContactDistance;

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

    // The Emscripten binding rejects a partially implemented JSImplementation,
    // so every callback must be present even when it does nothing.
    const contactListener = new jolt.CharacterContactListenerJS();
    contactListener.OnAdjustBodyVelocity = () => {};
    contactListener.OnContactValidate = () => true;
    contactListener.OnCharacterContactValidate = () => true;
    contactListener.OnContactAdded = () => {};
    contactListener.OnContactPersisted = () => {};
    contactListener.OnContactRemoved = () => {};
    contactListener.OnCharacterContactAdded = () => {};
    contactListener.OnCharacterContactPersisted = () => {};
    contactListener.OnCharacterContactRemoved = () => {};
    contactListener.OnCharacterContactSolve = () => {};
    contactListener.OnContactSolve = (
      inCharacter,
      _bodyID2,
      _subShapeID2,
      _contactPosition,
      inContactNormal,
      inContactVelocity,
      _contactMaterial,
      _characterVelocity,
      inNewCharacterVelocity,
    ) => {
      const self = jolt.wrapPointer(
        inCharacter as unknown as number,
        jolt.CharacterVirtual,
      );
      const contactVelocity = jolt.wrapPointer(
        inContactVelocity as unknown as number,
        jolt.Vec3,
      );
      const contactNormal = jolt.wrapPointer(
        inContactNormal as unknown as number,
        jolt.Vec3,
      );
      const newCharacterVelocity = jolt.wrapPointer(
        inNewCharacterVelocity as unknown as number,
        jolt.Vec3,
      );

      if (
        !stateRef.current.shouldSlide &&
        contactVelocity.IsNearZero() &&
        !self.IsSlopeTooSteep(contactNormal)
      ) {
        newCharacterVelocity.SetX(0);
        newCharacterVelocity.SetY(0);
        newCharacterVelocity.SetZ(0);
      }
    };

    character.SetListener(contactListener);

    const characterUp = new Vector3(up[0], up[1], up[2]).normalize();
    const upRotation = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      characterUp,
    );

    const updateSettings = new jolt.ExtendedUpdateSettings();

    if (options.enableStickToFloor) {
      updateSettings.mStickToFloorStepDown = jolt.Vec3.prototype.sZero();
    } else {
      const length = updateSettings.mStickToFloorStepDown.Length();
      updateSettings.mStickToFloorStepDown.Set(
        -characterUp.x * length,
        -characterUp.y * length,
        -characterUp.z * length,
      );
    }

    if (options.enableStairStep) {
      const length = updateSettings.mWalkStairsStepUp.Length();
      updateSettings.mWalkStairsStepUp.Set(
        characterUp.x * length,
        characterUp.y * length,
        characterUp.z * length,
      );
    } else {
      updateSettings.mWalkStairsStepUp = jolt.Vec3.prototype.sZero();
    }

    const tempVec3 = new jolt.Vec3();

    let debugMeshStanding: Mesh | null = null;
    let debugMeshCrouching: Mesh | null = null;

    if (debug) {
      debugMeshStanding = new Mesh(
        standingGeometry,
        createDebugMaterial("character"),
      );
      debugMeshCrouching = new Mesh(
        crouchingGeometry,
        createDebugMaterial("character"),
      );
      debugMeshCrouching.visible = false;
      scene.add(debugMeshStanding);
      scene.add(debugMeshCrouching);
    }

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

      const { ignoreHorizontalMovementLock = false, addToVelocity, overrideUpdate } =
        updateOptions;

      if (crouched !== stateRef.current.crouched) {
        stateRef.current.crouched = crouched;
        character.SetShape(
          crouched ? crouchingShape : standingShape,
          1.5 * physicsSystem.GetPhysicsSettings().mPenetrationSlop,
          broadPhaseFilter,
          layerFilter,
          bodyFilter,
          shapeFilter,
          joltInterface.GetTempAllocator(),
        );

        if (debugMeshStanding) debugMeshStanding.visible = !crouched;
        if (debugMeshCrouching) debugMeshCrouching.visible = crouched;
      }

      const moveSpeed = crouched
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

        if (jump && movingTowardsGround && !crouched) {
          scratch.copy(characterUp).multiplyScalar(options.jumpSpeed);
          newVelocity.add(scratch);
        }
      } else {
        newVelocity.copy(verticalVelocity);
      }

      scratch.copy(gravity).multiplyScalar(deltaTime).applyQuaternion(upRotation);
      newVelocity.add(scratch);

      scratch
        .copy(stateRef.current.desiredVelocity)
        .applyQuaternion(upRotation);
      newVelocity.add(scratch);

      if (addToVelocity) {
        newVelocity.add(addToVelocity);
      }

      const finalVelocity = overrideUpdate
        ? overrideUpdate(newVelocity, characterUp)
        : newVelocity;

      tempVec3.Set(finalVelocity.x, finalVelocity.y, finalVelocity.z);
      character.SetLinearVelocity(tempVec3);

      character.ExtendedUpdate(
        deltaTime,
        character.GetUp(),
        updateSettings,
        broadPhaseFilter,
        layerFilter,
        bodyFilter,
        shapeFilter,
        joltInterface.GetTempAllocator(),
      );
    };

    setCharacterApi({
      character,
      update,
      debugMeshStanding,
      debugMeshCrouching,
    });

    return () => {
      setCharacterApi(undefined);

      for (const mesh of [debugMeshStanding, debugMeshCrouching]) {
        if (!mesh) continue;
        scene.remove(mesh);
        disposeDebugMaterial(mesh);
      }

      standingGeometry.dispose();
      crouchingGeometry.dispose();

      if (state.destroyed) return;

      character.SetListener(null as unknown as Jolt.CharacterContactListener);
      jolt.destroy(contactListener);
      jolt.destroy(character);
      jolt.destroy(settings);

      standingShape.Release();
      crouchingShape.Release();

      jolt.destroy(updateSettings);
      jolt.destroy(tempVec3);
      jolt.destroy(upVector);
      jolt.destroy(startPosition);
      jolt.destroy(startRotation);
      jolt.destroy(shapeRotation);
      jolt.destroy(shapeFilter);
      jolt.destroy(bodyFilter);
      jolt.destroy(layerFilter);
      jolt.destroy(broadPhaseFilter);
    };
  }, [api, mount, scene]);

  useFrame(() => {
    if (!characterApi) return;

    const { character, debugMeshStanding, debugMeshCrouching } = characterApi;
    const position = character.GetPosition();
    const rotation = character.GetRotation();

    for (const mesh of [debugMeshStanding, debugMeshCrouching]) {
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
