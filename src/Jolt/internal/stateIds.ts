import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

/** The sequence number Jolt gives a body created with a chosen id. */
const STATED_SEQUENCE = 0;
const SEQUENCE_SHIFT = 23;
const INDEX_MASK = 0x7fffff;

export interface CharacterEntry {
  stateId: number | undefined;
  character: Jolt.CharacterVirtual;
  hook: string;
}

/**
 * A snapshot names every body by its Jolt `BodyID`, and Jolt hands those out
 * from a free list whose order depends on everything created and destroyed
 * before — so React's mount order decides them, and a second client mounting
 * the same scene gets different ones. A `stateId` makes the id the caller's:
 * the body is created with `CreateBodyWithID`, index `stateId`, sequence 0.
 */
export interface StateIdRegistry {
  createBody: (
    settings: Jolt.BodyCreationSettings,
    stateId: number | undefined,
    hook: string,
  ) => Jolt.Body;
  createSoftBody: (
    settings: Jolt.SoftBodyCreationSettings,
    stateId: number | undefined,
    hook: string,
  ) => Jolt.Body;
  /**
   * `CreateRagdoll` takes no ids, but it allocates from the free list's head.
   * Placeholders created on `base…base + count - 1` and destroyed last-first
   * leave exactly those ids on top, in order, with a sequence number that
   * wraps to 0 on reuse — so the ragdoll's next `count` bodies land on them.
   */
  reserve: (base: number, count: number, hook: string) => void;
  /** Throws unless `stateId` is in range and no body holds it. */
  check: (stateId: number, hook: string) => void;
  /** Throws if Jolt did not put `ids` on `base…` after a `reserve`. */
  verify: (ids: Jolt.BodyID[], base: number, hook: string) => void;
  /** Records who made a body, for the error that names it. */
  track: (id: Jolt.BodyID, hook: string) => void;
  hookOf: (id: Jolt.BodyID) => string | undefined;
  isStated: (id: Jolt.BodyID) => boolean;
  addCharacter: (entry: CharacterEntry) => () => void;
  characters: () => readonly CharacterEntry[];
  destroy: () => void;
}

export const bodyIndex = (indexAndSequence: number) =>
  indexAndSequence & INDEX_MASK;

export const createStateIdRegistry = (
  jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
): StateIdRegistry => {
  const bodyInterface = physicsSystem.GetBodyInterface();
  const lock = physicsSystem.GetBodyLockInterfaceNoLock();
  const owners = new Map<number, { sequence: number; hook: string }>();
  let characters: CharacterEntry[] = [];

  const track = (id: Jolt.BodyID, hook: string) => {
    const value = id.GetIndexAndSequenceNumber();
    owners.set(bodyIndex(value), { sequence: value >>> SEQUENCE_SHIFT, hook });
  };

  const occupant = (index: number) => {
    const owner = owners.get(index);
    if (!owner) return "a body created outside the hooks";

    const id = new jolt.BodyID((owner.sequence << SEQUENCE_SHIFT) | index);
    const live = jolt.getPointer(lock.TryGetBody(id)) !== 0;
    jolt.destroy(id);

    if (!live) return "a body created outside the hooks";
    return owner.sequence === STATED_SEQUENCE
      ? `${owner.hook} (stateId ${index})`
      : `${owner.hook} without a stateId`;
  };

  const validate = (stateId: number, hook: string) => {
    const max = physicsSystem.GetMaxBodies();

    if (!Number.isInteger(stateId) || stateId < 0 || stateId >= max) {
      throw new Error(
        `r3f-jolt: ${hook} stateId ${stateId} must be a whole number from 0 ` +
          `to ${max - 1}, below \`maxBodies\` on <Physics>.`,
      );
    }
  };

  const taken = (stateId: number, hook: string) =>
    new Error(
      `r3f-jolt: ${hook} stateId ${stateId} is taken by ${occupant(stateId)}. ` +
        "Every body in a world that is snapshotted needs a stateId of its own.",
    );

  const withID = <B>(
    stateId: number,
    hook: string,
    create: (id: Jolt.BodyID) => B,
  ) => {
    validate(stateId, hook);

    const id = new jolt.BodyID(stateId);
    const body = create(id);
    jolt.destroy(id);

    if (jolt.getPointer(body) === 0) throw taken(stateId, hook);
    return body;
  };

  const finish = (body: Jolt.Body, hook: string) => {
    if (jolt.getPointer(body) !== 0) track(body.GetID(), hook);
    return body;
  };

  return {
    createBody: (settings, stateId, hook) =>
      finish(
        stateId === undefined
          ? bodyInterface.CreateBody(settings)
          : withID(stateId, hook, (id) =>
              bodyInterface.CreateBodyWithID(id, settings),
            ),
        hook,
      ),

    createSoftBody: (settings, stateId, hook) =>
      finish(
        stateId === undefined
          ? bodyInterface.CreateSoftBody(settings)
          : withID(stateId, hook, (id) =>
              bodyInterface.CreateSoftBodyWithID(id, settings),
            ),
        hook,
      ),

    reserve: (base, count, hook) => {
      validate(base, hook);
      validate(base + count - 1, hook);

      const shape = new jolt.EmptyShape();
      shape.AddRef();
      const position = new jolt.RVec3(0, 0, 0);
      const rotation = new jolt.Quat(0, 0, 0, 1);
      const settings = new jolt.BodyCreationSettings(
        shape,
        position,
        rotation,
        jolt.EMotionType_Static,
        0,
      );
      jolt.destroy(position);
      jolt.destroy(rotation);

      const placeholders: Jolt.BodyID[] = [];
      let blocked = -1;

      for (let offset = 0; offset < count; offset += 1) {
        const id = new jolt.BodyID((0xff << SEQUENCE_SHIFT) | (base + offset));
        const body = bodyInterface.CreateBodyWithID(id, settings);
        jolt.destroy(id);

        if (jolt.getPointer(body) === 0) {
          blocked = base + offset;
          break;
        }
        placeholders.push(body.GetID());
      }

      for (let index = placeholders.length - 1; index >= 0; index -= 1) {
        bodyInterface.DestroyBody(placeholders[index]);
      }

      jolt.destroy(settings);
      shape.Release();

      if (blocked >= 0) throw taken(blocked, hook);
    },

    check: (stateId, hook) => {
      validate(stateId, hook);

      const ids = new jolt.BodyIDVector();
      physicsSystem.GetBodies(ids);
      let held = false;
      for (let index = 0; index < ids.size() && !held; index += 1) {
        held = bodyIndex(ids.at(index).GetIndexAndSequenceNumber()) === stateId;
      }
      jolt.destroy(ids);

      if (held) throw taken(stateId, hook);
    },

    verify: (ids, base, hook) => {
      ids.forEach((id, offset) => {
        if (id.GetIndexAndSequenceNumber() !== base + offset) {
          throw new Error(
            `r3f-jolt: ${hook} could not place its bodies on stateIds ` +
              `${base}…${base + ids.length - 1}.`,
          );
        }
      });
    },

    track,
    hookOf: (id) => owners.get(bodyIndex(id.GetIndexAndSequenceNumber()))?.hook,
    isStated: (id) => {
      const value = id.GetIndexAndSequenceNumber();
      const owner = owners.get(bodyIndex(value));
      return (
        value >>> SEQUENCE_SHIFT === STATED_SEQUENCE &&
        owner?.sequence === STATED_SEQUENCE
      );
    },

    addCharacter: (entry) => {
      characters = [...characters, entry];
      return () => {
        characters = characters.filter((other) => other !== entry);
      };
    },
    characters: () => characters,

    destroy: () => {
      owners.clear();
      characters = [];
    },
  };
};
