import { Quaternion, Vector3 } from "three";
import type Jolt from "jolt-physics";
import type { ContactRegistry, JoltModule } from "../types";

/**
 * A body the character touched. One object per callback kind, refilled on every
 * call: copy what you keep. `point` and `normal` are zero where Jolt passes
 * none (validate, removed).
 */
export interface CharacterBodyContact {
  /** `GetIndexAndSequenceNumber()` of the body. */
  bodyID: number;
  userData: number;
  subShapeID: number;
  point: Vector3;
  /** From the character towards the body. */
  normal: Vector3;
  /** Added and persisted only: whether the body pushes the character, and whether it is pushed back. */
  settings: Jolt.CharacterContactSettings | null;
}

/** Another character the character touched; refilled the same way. */
export interface CharacterToCharacterContact {
  /** Null on removed: the other character may already be gone. */
  character: Jolt.CharacterVirtual | null;
  characterID: number;
  userData: number;
  subShapeID: number;
  point: Vector3;
  /** From the character towards the other one. */
  normal: Vector3;
  settings: Jolt.CharacterContactSettings | null;
}

/** For the solve callbacks: change `result` to change how the character moves. */
export interface CharacterContactVelocities {
  /** The surface's velocity at the contact. */
  contact: Vector3;
  /** The character's velocity going into the contact. */
  character: Vector3;
  /** The character's velocity coming out of it. Written back after the handler. */
  result: Vector3;
}

/**
 * Jolt's `CharacterContactListener`, every callback of it. They run inside
 * `update()`, synchronously: read the world, do not add or remove bodies.
 */
export interface CharacterContactHandlers {
  /**
   * Change how fast the character thinks `body` moves. Conveyors registered
   * with `useConveyor` are already added by the time this runs.
   */
  onAdjustBodyVelocity?: (
    body: Jolt.Body,
    linear: Vector3,
    angular: Vector3,
  ) => void;
  /** Return false to walk through the body. */
  onContactValidate?: (contact: CharacterBodyContact) => boolean;
  /** Return false to walk through the character. */
  onCharacterContactValidate?: (
    contact: CharacterToCharacterContact,
  ) => boolean;
  onContactAdded?: (contact: CharacterBodyContact) => void;
  onContactPersisted?: (contact: CharacterBodyContact) => void;
  onContactRemoved?: (contact: CharacterBodyContact) => void;
  onCharacterContactAdded?: (contact: CharacterToCharacterContact) => void;
  onCharacterContactPersisted?: (contact: CharacterToCharacterContact) => void;
  onCharacterContactRemoved?: (contact: CharacterToCharacterContact) => void;
  onContactSolve?: (
    contact: CharacterBodyContact,
    velocities: CharacterContactVelocities,
  ) => void;
  onCharacterContactSolve?: (
    contact: CharacterToCharacterContact,
    velocities: CharacterContactVelocities,
  ) => void;
}

const bodyContact = (): CharacterBodyContact => ({
  bodyID: 0,
  userData: 0,
  subShapeID: 0,
  point: new Vector3(),
  normal: new Vector3(),
  settings: null,
});

const characterContact = (): CharacterToCharacterContact => ({
  character: null,
  characterID: 0,
  userData: 0,
  subShapeID: 0,
  point: new Vector3(),
  normal: new Vector3(),
  settings: null,
});

const velocities = (): CharacterContactVelocities => ({
  contact: new Vector3(),
  character: new Vector3(),
  result: new Vector3(),
});

interface CharacterListenerOptions {
  handlers: () => CharacterContactHandlers;
  contacts: ContactRegistry;
  bodyInterface: Jolt.BodyInterface;
  /** False while the character is asked to stand still, so it does not slide off a slope. */
  shouldSlide: () => boolean;
}

export const createCharacterListener = (
  jolt: JoltModule,
  { handlers, contacts, bodyInterface, shouldSlide }: CharacterListenerOptions,
) => {
  const added = bodyContact();
  const persisted = bodyContact();
  const removed = bodyContact();
  const validated = bodyContact();
  const solved = bodyContact();
  const addedCharacter = characterContact();
  const persistedCharacter = characterContact();
  const removedCharacter = characterContact();
  const validatedCharacter = characterContact();
  const solvedCharacter = characterContact();
  const solveVelocities = velocities();

  const linear = new Vector3();
  const angular = new Vector3();
  const surface = new Vector3();
  const rotation = new Quaternion();

  /** Removed callbacks get an ID and nothing else, so user data is kept from when the contact was made. */
  const bodyUserData = new Map<number, number>();
  const characterUserData = new Map<number, number>();

  const readVec3 = (target: Vector3, pointer: number) => {
    const vector = jolt.wrapPointer(pointer, jolt.Vec3);
    return target.set(vector.GetX(), vector.GetY(), vector.GetZ());
  };

  const readRVec3 = (target: Vector3, pointer: number) => {
    const vector = jolt.wrapPointer(pointer, jolt.RVec3);
    return target.set(vector.GetX(), vector.GetY(), vector.GetZ());
  };

  const writeVec3 = (pointer: number, source: Vector3) => {
    jolt.wrapPointer(pointer, jolt.Vec3).Set(source.x, source.y, source.z);
  };

  const bodyIDAt = (pointer: number) =>
    jolt.wrapPointer(pointer, jolt.BodyID).GetIndexAndSequenceNumber();

  const subShapeIDAt = (pointer: number) =>
    jolt.wrapPointer(pointer, jolt.SubShapeID).GetValue();

  const otherCharacter = (pointer: number) =>
    jolt.wrapPointer(pointer, jolt.CharacterVirtual);

  const fillBody = (
    contact: CharacterBodyContact,
    bodyPointer: number,
    subShapePointer: number,
  ) => {
    contact.bodyID = bodyIDAt(bodyPointer);
    contact.userData = bodyInterface.GetUserData(
      jolt.wrapPointer(bodyPointer, jolt.BodyID),
    );
    contact.subShapeID = subShapeIDAt(subShapePointer);
    return contact;
  };

  const fillCharacter = (
    contact: CharacterToCharacterContact,
    characterPointer: number,
    subShapePointer: number,
  ) => {
    const character = otherCharacter(characterPointer);
    contact.character = character;
    contact.characterID = character.GetID().GetValue();
    contact.userData = character.GetUserData();
    contact.subShapeID = subShapeIDAt(subShapePointer);
    return contact;
  };

  const fillPlace = (
    contact: CharacterBodyContact | CharacterToCharacterContact,
    positionPointer: number,
    normalPointer: number,
    settingsPointer: number,
  ) => {
    readRVec3(contact.point, positionPointer);
    readVec3(contact.normal, normalPointer);
    contact.settings = jolt.wrapPointer(
      settingsPointer,
      jolt.CharacterContactSettings,
    );
  };

  /** A belt registered with `useConveyor`, added the way the body's own velocity would be. */
  const addConveyor = (body: Jolt.Body) => {
    const belt = contacts.surfaceVelocityOf(
      body.GetID().GetIndexAndSequenceNumber(),
    );
    if (!belt) return false;

    if (belt.space === "world") {
      linear.add(belt.linear);
      angular.add(belt.angular);
      return true;
    }

    const quat = body.GetRotation();
    rotation.set(quat.GetX(), quat.GetY(), quat.GetZ(), quat.GetW());
    linear.add(surface.copy(belt.linear).applyQuaternion(rotation));
    angular.add(surface.copy(belt.angular).applyQuaternion(rotation));
    return true;
  };

  const listener = new jolt.CharacterContactListenerJS();

  listener.OnAdjustBodyVelocity = function onAdjustBodyVelocity(
    _character,
    inBody2,
    ioLinearVelocity,
    ioAngularVelocity,
  ) {
    const adjust = handlers().onAdjustBodyVelocity;
    const body = jolt.wrapPointer(inBody2, jolt.Body);

    readVec3(linear, ioLinearVelocity);
    readVec3(angular, ioAngularVelocity);

    const carried = addConveyor(body);
    adjust?.(body, linear, angular);
    if (!carried && !adjust) return;

    writeVec3(ioLinearVelocity, linear);
    writeVec3(ioAngularVelocity, angular);
  };

  listener.OnContactValidate = function onContactValidate(
    _character,
    inBodyID2,
    inSubShapeID2,
  ) {
    const validate = handlers().onContactValidate;
    if (!validate) return true;
    validated.point.set(0, 0, 0);
    validated.normal.set(0, 0, 0);
    validated.settings = null;
    return validate(fillBody(validated, inBodyID2, inSubShapeID2));
  };

  listener.OnCharacterContactValidate = function onCharacterContactValidate(
    _character,
    inOtherCharacter,
    inSubShapeID2,
  ) {
    const validate = handlers().onCharacterContactValidate;
    if (!validate) return true;
    validatedCharacter.point.set(0, 0, 0);
    validatedCharacter.normal.set(0, 0, 0);
    validatedCharacter.settings = null;
    return validate(
      fillCharacter(validatedCharacter, inOtherCharacter, inSubShapeID2),
    );
  };

  listener.OnContactAdded = function onContactAdded(
    _character,
    inBodyID2,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    ioSettings,
  ) {
    const { onContactAdded: handle, onContactRemoved } = handlers();
    if (!handle && !onContactRemoved) return;
    fillBody(added, inBodyID2, inSubShapeID2);
    bodyUserData.set(added.bodyID, added.userData);
    if (!handle) return;
    fillPlace(added, inContactPosition, inContactNormal, ioSettings);
    handle(added);
  };

  listener.OnContactPersisted = function onContactPersisted(
    _character,
    inBodyID2,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    ioSettings,
  ) {
    const handle = handlers().onContactPersisted;
    if (!handle) return;
    fillBody(persisted, inBodyID2, inSubShapeID2);
    fillPlace(persisted, inContactPosition, inContactNormal, ioSettings);
    handle(persisted);
  };

  listener.OnContactRemoved = function onContactRemoved(
    _character,
    inBodyID2,
    inSubShapeID2,
  ) {
    const handle = handlers().onContactRemoved;
    const bodyID = bodyIDAt(inBodyID2);
    const userData = bodyUserData.get(bodyID) ?? 0;
    bodyUserData.delete(bodyID);
    if (!handle) return;
    removed.bodyID = bodyID;
    removed.userData = userData;
    removed.subShapeID = subShapeIDAt(inSubShapeID2);
    removed.point.set(0, 0, 0);
    removed.normal.set(0, 0, 0);
    removed.settings = null;
    handle(removed);
  };

  listener.OnCharacterContactAdded = function onCharacterContactAdded(
    _character,
    inOtherCharacter,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    ioSettings,
  ) {
    const { onCharacterContactAdded: handle, onCharacterContactRemoved } =
      handlers();
    if (!handle && !onCharacterContactRemoved) return;
    fillCharacter(addedCharacter, inOtherCharacter, inSubShapeID2);
    characterUserData.set(addedCharacter.characterID, addedCharacter.userData);
    if (!handle) return;
    fillPlace(addedCharacter, inContactPosition, inContactNormal, ioSettings);
    handle(addedCharacter);
  };

  listener.OnCharacterContactPersisted = function onCharacterContactPersisted(
    _character,
    inOtherCharacter,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    ioSettings,
  ) {
    const handle = handlers().onCharacterContactPersisted;
    if (!handle) return;
    fillCharacter(persistedCharacter, inOtherCharacter, inSubShapeID2);
    fillPlace(
      persistedCharacter,
      inContactPosition,
      inContactNormal,
      ioSettings,
    );
    handle(persistedCharacter);
  };

  // Jolt passes the other character's ID here, not the character.
  listener.OnCharacterContactRemoved = function onCharacterContactRemoved(
    _character,
    inOtherCharacterID,
    inSubShapeID2,
  ) {
    const handle = handlers().onCharacterContactRemoved;
    const characterID = jolt
      .wrapPointer(inOtherCharacterID, jolt.CharacterID)
      .GetValue();
    const userData = characterUserData.get(characterID) ?? 0;
    characterUserData.delete(characterID);
    if (!handle) return;
    removedCharacter.character = null;
    removedCharacter.characterID = characterID;
    removedCharacter.userData = userData;
    removedCharacter.subShapeID = subShapeIDAt(inSubShapeID2);
    removedCharacter.point.set(0, 0, 0);
    removedCharacter.normal.set(0, 0, 0);
    removedCharacter.settings = null;
    handle(removedCharacter);
  };

  const readVelocities = (
    contactVelocity: number,
    characterVelocity: number,
    newCharacterVelocity: number,
  ) => {
    readVec3(solveVelocities.contact, contactVelocity);
    readVec3(solveVelocities.character, characterVelocity);
    readVec3(solveVelocities.result, newCharacterVelocity);
    return solveVelocities;
  };

  listener.OnContactSolve = function onContactSolve(
    inCharacter,
    inBodyID2,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    inContactVelocity,
    _contactMaterial,
    inCharacterVelocity,
    ioNewCharacterVelocity,
  ) {
    const self = jolt.wrapPointer(inCharacter, jolt.CharacterVirtual);
    const contactVelocity = jolt.wrapPointer(inContactVelocity, jolt.Vec3);
    const contactNormal = jolt.wrapPointer(inContactNormal, jolt.Vec3);

    // Standing still on a slope it can walk: hold, rather than slide down it.
    if (
      !shouldSlide() &&
      contactVelocity.IsNearZero() &&
      !self.IsSlopeTooSteep(contactNormal)
    ) {
      jolt.wrapPointer(ioNewCharacterVelocity, jolt.Vec3).Set(0, 0, 0);
    }

    const handle = handlers().onContactSolve;
    if (!handle) return;
    fillBody(solved, inBodyID2, inSubShapeID2);
    readRVec3(solved.point, inContactPosition);
    readVec3(solved.normal, inContactNormal);
    solved.settings = null;
    handle(
      solved,
      readVelocities(
        inContactVelocity,
        inCharacterVelocity,
        ioNewCharacterVelocity,
      ),
    );
    writeVec3(ioNewCharacterVelocity, solveVelocities.result);
  };

  listener.OnCharacterContactSolve = function onCharacterContactSolve(
    _character,
    inOtherCharacter,
    inSubShapeID2,
    inContactPosition,
    inContactNormal,
    inContactVelocity,
    _contactMaterial,
    inCharacterVelocity,
    ioNewCharacterVelocity,
  ) {
    const handle = handlers().onCharacterContactSolve;
    if (!handle) return;
    fillCharacter(solvedCharacter, inOtherCharacter, inSubShapeID2);
    readRVec3(solvedCharacter.point, inContactPosition);
    readVec3(solvedCharacter.normal, inContactNormal);
    solvedCharacter.settings = null;
    handle(
      solvedCharacter,
      readVelocities(
        inContactVelocity,
        inCharacterVelocity,
        ioNewCharacterVelocity,
      ),
    );
    writeVec3(ioNewCharacterVelocity, solveVelocities.result);
  };

  return listener;
};
