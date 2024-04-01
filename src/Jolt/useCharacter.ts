/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useCallback, useEffect, useRef, useState } from "react";
import { useJolt } from "./useJolt";
import {
  CapsuleGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { useThree } from "@react-three/fiber";
import Jolt from "jolt-physics";

const DegreesToRadians = (deg: number) => deg * (Math.PI / 180.0);

const upRotationX = 0;
const upRotationZ = 0;
const maxSlopeAngle = DegreesToRadians(45.0);
const maxStrength = 100.0;
const characterPadding = 0.02;
const penetrationRecoverySpeed = 1.0;
const predictiveContactDistance = 0.1;

export const useCharacter = ({
  options = {
    height: {
      standing: 2,
      crouching: 1,
    },
    radius: {
      standing: 1,
      crouching: 0.8,
    },
    moveDuringJump: true,
    moveSpeed: 6,
    crouchMoveSpeedRatio: 0.5,
    jumpSpeed: 15,
    enableInertia: true,
    enableStairStep: true,
    enableStickToFloor: true,
  },
  position,
  rotation = [0, 0, 0, 1],
  debug = false,
  mass = 1000,
}: {
  options: {
    height: {
      standing: number;
      crouching: number;
    };
    radius: {
      standing: number;
      crouching: number;
    };
    moveDuringJump: boolean;
    moveSpeed: number;
    crouchMoveSpeedRatio: number;
    jumpSpeed: number;
    enableInertia: boolean;
    enableStairStep: boolean;
    enableStickToFloor: boolean;
  };
  position: [number, number, number];
  rotation?: [number, number, number, number];
  debug?: boolean;
  mass?: number;
}) => {
  const { Jolt, joltInterface, physicsSystem, layers } = useJolt();
  const scene = useThree((state) => state.scene);

  const [api, setApi] = useState<{
    character: Jolt.CharacterVirtual;
    update: (
      direction: Vector3,
      jump: boolean,
      crouched: boolean,
      deltaTime: number,
      ignoreHorizontalMovementLock?: boolean,
      overrideUpdate?: (velocity: Vector3, up: Vector3) => Vector3
    ) => void;
    debugMeshStanding: Mesh | null;
    debugMeshCrouching: Mesh | null;
  }>();

  const characterRef = useRef({
    shouldSlide: true,
    desiredVelocity: new Vector3(),
  });

  const init = useCallback(() => {
    const updateSettings = new Jolt.ExtendedUpdateSettings();

    const objectVsBroadPhaseLayerFilter =
      joltInterface.GetObjectVsBroadPhaseLayerFilter();
    const objectLayerPairFilter = joltInterface.GetObjectLayerPairFilter();

    const movingBPFilter = new Jolt.DefaultBroadPhaseLayerFilter(
      objectVsBroadPhaseLayerFilter,
      layers.LAYER_MOVING
    );
    const movingLayerFilter = new Jolt.DefaultObjectLayerFilter(
      objectLayerPairFilter,
      layers.LAYER_MOVING
    );
    const bodyFilter = new Jolt.BodyFilter();
    const shapeFilter = new Jolt.ShapeFilter();

    const characterPosition = new Jolt.Vec3(
      0,
      0.5 * options.height.standing + options.radius.standing,
      0
    );

    let characterRotation: Jolt.Quat;

    if (rotation) {
      characterRotation = new Jolt.Quat(
        rotation[0],
        rotation[1],
        rotation[2],
        rotation[3]
      );
    } else {
      characterRotation = new Jolt.Quat();
    }

    Jolt.Quat.prototype.sIdentity();

    const standingShape = new Jolt.RotatedTranslatedShapeSettings(
      characterPosition,
      characterRotation,
      new Jolt.CapsuleShapeSettings(
        0.5 * options.height.standing,
        options.radius.standing
      )
    )
      .Create()
      .Get();

    const standingGeometry = new CapsuleGeometry(
      options.radius.standing,
      options.height.standing,
      4,
      8
    ).translate(0, 0.5 * options.height.standing + options.radius.standing, 0);

    const crouchingShape = new Jolt.RotatedTranslatedShapeSettings(
      characterPosition,
      characterRotation,
      new Jolt.CapsuleShapeSettings(
        0.5 * options.height.crouching,
        options.radius.crouching
      )
    )
      .Create()
      .Get();

    const crouchingGeometry = new CapsuleGeometry(
      options.radius.crouching,
      options.height.crouching,
      4,
      8
    ).translate(
      0,
      0.5 * options.height.crouching + options.radius.crouching,
      0
    );

    const settings = new Jolt.CharacterVirtualSettings();
    settings.mMass = mass;
    settings.mMaxSlopeAngle = maxSlopeAngle;
    settings.mMaxStrength = maxStrength;
    settings.mShape = standingShape;
    settings.mBackFaceMode = Jolt.EBackFaceMode_CollideWithBackFaces;
    settings.mCharacterPadding = characterPadding;
    settings.mPenetrationRecoverySpeed = penetrationRecoverySpeed;
    settings.mPredictiveContactDistance = predictiveContactDistance;
    settings.mSupportingVolume = new Jolt.Plane(
      Jolt.Vec3.prototype.sAxisY(),
      -options.radius.standing
    );

    const character = new Jolt.CharacterVirtual(
      settings,
      new Jolt.Vec3(position[0], position[1], position[2]),
      Jolt.Quat.prototype.sIdentity(),
      physicsSystem
    );

    const characterContactListener = new Jolt.CharacterContactListenerJS();
    characterContactListener.OnAdjustBodyVelocity = (
      _character,
      _body2,
      _linearVelocity,
      _angularVelocity
    ) => {};
    characterContactListener.OnContactValidate = (
      _character,
      _bodyID2,
      _subShapeID2
    ) => {
      return true;
    };
    characterContactListener.OnContactAdded = (
      _character,
      _bodyID2,
      _subShapeID2,
      _contactPosition,
      _contactNormal,
      _settings
    ) => {};
    characterContactListener.OnContactSolve = (
      character,
      _bodyID2,
      _subShapeID2,
      _contactPosition,
      contactNormal,
      contactVelocity,
      _contactMaterial,
      _characterVelocity,
      newCharacterVelocity
    ) => {
      // @ts-ignore
      character = Jolt.wrapPointer(character, Jolt.CharacterVirtual);
      // @ts-ignore
      contactVelocity = Jolt.wrapPointer(contactVelocity, Jolt.Vec3);

      newCharacterVelocity = Jolt.wrapPointer(
        // @ts-ignore
        newCharacterVelocity,
        Jolt.Vec3
      );
      // @ts-ignore
      contactNormal = Jolt.wrapPointer(contactNormal, Jolt.Vec3);

      if (
        !characterRef.current.shouldSlide &&
        contactVelocity.IsNearZero() &&
        !character.IsSlopeTooSteep(contactNormal)
      ) {
        newCharacterVelocity.SetX(0);
        newCharacterVelocity.SetY(0);
        newCharacterVelocity.SetZ(0);
      }
    };

    character.SetListener(characterContactListener);

    const characterUp = new Vector3(
      character.GetUp().GetX(),
      character.GetUp().GetY(),
      character.GetUp().GetZ()
    );

    if (options.enableStickToFloor) {
      updateSettings.mStickToFloorStepDown = Jolt.Vec3.prototype.sZero();
    } else {
      const vec = characterUp
        .clone()
        .multiplyScalar(-updateSettings.mStickToFloorStepDown.Length());
      updateSettings.mStickToFloorStepDown.Set(vec.x, vec.y, vec.z);
    }

    if (!options.enableStairStep) {
      updateSettings.mWalkStairsStepUp = Jolt.Vec3.prototype.sZero();
    } else {
      const vec = characterUp
        .clone()
        .multiplyScalar(updateSettings.mWalkStairsStepUp.Length());

      updateSettings.mWalkStairsStepUp.Set(vec.x, vec.y, vec.z);
    }

    const tempVec3 = new Jolt.Vec3();

    let debugMeshStanding: Mesh | null = null;
    let debugMeshCrouching: Mesh | null = null;

    if (debug) {
      debugMeshStanding = new Mesh(
        standingGeometry,
        new MeshBasicMaterial({ color: "black", wireframe: true })
      );
      scene.add(debugMeshStanding);

      debugMeshCrouching = new Mesh(
        crouchingGeometry,
        new MeshBasicMaterial({ color: "black", wireframe: true })
      );
      scene.add(debugMeshCrouching);
    }

    const update = (
      direction: THREE.Vector3,
      jump: boolean,
      crouched: boolean,
      deltaTime: number,
      ignoreHorizontalMovementLock = false,
      overrideUpdate?: (velocity: Vector3, up: Vector3) => Vector3
    ) => {
      if (crouched) {
        character.SetShape(
          crouchingShape,
          1.5 * physicsSystem.GetPhysicsSettings().mPenetrationSlop,
          movingBPFilter,
          movingLayerFilter,
          bodyFilter,
          shapeFilter,
          joltInterface.GetTempAllocator()
        );
      } else {
        character.SetShape(
          standingShape,
          1.5 * physicsSystem.GetPhysicsSettings().mPenetrationSlop,
          movingBPFilter,
          movingLayerFilter,
          bodyFilter,
          shapeFilter,
          joltInterface.GetTempAllocator()
        );
      }

      const characterUp = new Vector3(
        character.GetUp().GetX(),
        character.GetUp().GetY(),
        character.GetUp().GetZ()
      );

      const enableHorizontalMovement =
        options.moveDuringJump || character.IsSupported();

      if (enableHorizontalMovement || ignoreHorizontalMovementLock) {
        characterRef.current.shouldSlide = !(direction.length() < 1.0e-12);

        if (options.enableInertia) {
          characterRef.current.desiredVelocity
            .multiplyScalar(0.75)
            .add(
              direction.multiplyScalar(
                0.25 *
                  (crouched
                    ? options.moveSpeed * options.crouchMoveSpeedRatio
                    : options.moveSpeed)
              )
            );
        } else {
          characterRef.current.desiredVelocity
            .copy(direction)
            .multiplyScalar(
              crouched
                ? options.moveSpeed * options.crouchMoveSpeedRatio
                : options.moveSpeed
            );
        }
      } else {
        characterRef.current.shouldSlide = true;
      }

      tempVec3.Set(upRotationX, 0, upRotationZ);

      const characterUpRotation = Jolt.Quat.prototype.sEulerAngles(tempVec3);
      character.SetUp(characterUpRotation.RotateAxisY());
      character.SetRotation(characterUpRotation);

      const upRotation = new Quaternion(
        characterUpRotation.GetX(),
        characterUpRotation.GetY(),
        characterUpRotation.GetZ(),
        characterUpRotation.GetW()
      );

      character.UpdateGroundVelocity();

      const linearVelocity = new Vector3(
        character.GetLinearVelocity().GetX(),
        character.GetLinearVelocity().GetY(),
        character.GetLinearVelocity().GetZ()
      );

      const verticalVelocity = characterUp
        .clone()
        .multiplyScalar(linearVelocity.dot(characterUp));

      const groundVelocity = new Vector3(
        character.GetGroundVelocity().GetX(),
        character.GetGroundVelocity().GetY(),
        character.GetGroundVelocity().GetZ()
      );
      const gravity = new Vector3(
        physicsSystem.GetGravity().GetX(),
        physicsSystem.GetGravity().GetY(),
        physicsSystem.GetGravity().GetZ()
      );

      let newVelocity = new Vector3();

      const movingTowardsGround = verticalVelocity.y - groundVelocity.y < 0.1;

      if (
        character.GetGroundState() == Jolt.EGroundState_OnGround &&
        (options.enableInertia
          ? movingTowardsGround
          : !character.IsSlopeTooSteep(character.GetGroundNormal()))
      ) {
        newVelocity = groundVelocity;

        if (jump && movingTowardsGround && !crouched) {
          newVelocity.add(characterUp.multiplyScalar(options.jumpSpeed));
        }
      } else {
        newVelocity = verticalVelocity.clone();
      }

      newVelocity.add(
        gravity.multiplyScalar(deltaTime).applyQuaternion(upRotation)
      );

      newVelocity.add(
        characterRef.current.desiredVelocity.clone().applyQuaternion(upRotation)
      );

      if (overrideUpdate) {
        newVelocity = overrideUpdate(newVelocity, characterUp);
      }

      tempVec3.Set(newVelocity.x, newVelocity.y, newVelocity.z);

      character.SetLinearVelocity(tempVec3);

      characterUp.multiplyScalar(-physicsSystem.GetGravity().Length());

      character.ExtendedUpdate(
        deltaTime,
        character.GetUp(),
        updateSettings,
        movingBPFilter,
        movingLayerFilter,
        bodyFilter,
        shapeFilter,
        joltInterface.GetTempAllocator()
      );

      if (crouched) {
        debugMeshStanding && (debugMeshStanding.visible = false);
        debugMeshCrouching && (debugMeshCrouching.visible = true);
      } else {
        debugMeshStanding && (debugMeshStanding.visible = true);
        debugMeshCrouching && (debugMeshCrouching.visible = false);
      }

      if (debugMeshStanding && debugMeshStanding.visible) {
        debugMeshStanding.position.copy(
          new Vector3(
            character.GetPosition().GetX(),
            character.GetPosition().GetY(),
            character.GetPosition().GetZ()
          )
        );

        debugMeshStanding.quaternion.copy(
          new Quaternion(
            character.GetRotation().GetX(),
            character.GetRotation().GetY(),
            character.GetRotation().GetZ(),
            character.GetRotation().GetW()
          )
        );
      }

      if (debugMeshCrouching && debugMeshCrouching.visible) {
        debugMeshCrouching.position.copy(
          new Vector3(
            character.GetPosition().GetX(),
            character.GetPosition().GetY(),
            character.GetPosition().GetZ()
          )
        );

        debugMeshCrouching.quaternion.copy(
          new Quaternion(
            character.GetRotation().GetX(),
            character.GetRotation().GetY(),
            character.GetRotation().GetZ(),
            character.GetRotation().GetW()
          )
        );
      }
    };

    return {
      api: { character, update, debugMeshStanding, debugMeshCrouching },
      cleanup: () => {
        Jolt.destroy(character);
        Jolt.destroy(characterPosition);
        Jolt.destroy(characterRotation);
        Jolt.destroy(tempVec3);
        if (debugMeshStanding) {
          scene.remove(debugMeshStanding);
          debugMeshStanding.geometry.dispose();
          if (debugMeshStanding.material instanceof MeshBasicMaterial) {
            debugMeshStanding.material.dispose();
          }
        }
        if (debugMeshCrouching) {
          scene.remove(debugMeshCrouching);
          debugMeshCrouching.geometry.dispose();
          if (debugMeshCrouching.material instanceof MeshBasicMaterial) {
            debugMeshCrouching.material.dispose();
          }
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { api, cleanup } = init();
    setApi(api);
    return cleanup;
  }, [init]);

  return [api] as [
    {
      character: Jolt.CharacterVirtual;
      update: (
        direction: Vector3,
        jump: boolean,
        crouched: boolean,
        deltaTime: number,
        ignoreHorizontalMovementLock?: boolean,
        overrideUpdate?: (velocity: Vector3, up: Vector3) => Vector3
      ) => void;
      debugMeshStanding: Mesh | null;
      debugMeshCrouching: Mesh | null;
    }
  ];
};
