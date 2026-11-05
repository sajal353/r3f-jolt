import type Jolt from "jolt-physics";
import type {
  AttachedConstraint,
  ConstraintRegistry,
  JoltModule,
  PhysicsTiming,
  StateFilter,
} from "../types";
import { createStateReader, createStateWriter } from "./stateStream";
import type { CharacterEntry, StateIdRegistry } from "./stateIds";

/**
 * An arbitrary signature at the start of every snapshot: written
 * little-endian, its bytes are the ASCII for "R3JS", short for r3f-jolt state.
 * Lets `restoreState` reject bytes that never came from `saveState` before
 * Jolt reads them as a world.
 */
const MAGIC = 0x534a3352;
/** Bumped whenever the layout below changes; older snapshots are refused. */
const VERSION = 1;
/** Header flag: a filtered snapshot, holding only what the filter selected. */
const PARTIAL = 1;

/**
 * What a hook keeps in JS that the next steps depend on, or that a restore must
 * agree with: Jolt's stream has no room for a character's inertia or a sensor's
 * `inside` set. A snapshot carries these numbers beside the bodies they belong
 * to, so a restored world neither moves differently nor reports stale contacts.
 */
export interface SideState {
  /** Numbered in `SIDE_TAGS`, so bytes do not depend on who mounted first. */
  tag: keyof typeof SIDE_TAGS;
  /** Whose state this is: saved with it, and left out when a filter skips it. */
  owner: "body" | "constraint" | "character";
  /** The owner's number: a body's id value, otherwise its `stateId`. */
  id: number;
  save: () => number[];
  restore: (values: number[]) => void;
}

const SIDE_TAGS = {
  character: 1,
  car: 2,
  swimming: 3,
  sensor: 4,
  load: 5,
  shape: 6,
};

interface SavedSide {
  tag: number;
  id: number;
  values: number[];
}

interface Selection {
  partial: boolean;
  body: (value: number) => boolean;
  constraint: (entry: AttachedConstraint) => boolean;
  character: (entry: CharacterEntry) => boolean;
}

interface Header {
  partial: boolean;
  stepCount: number;
  elapsed: number;
  bodies: number[];
  constraints: number[];
  characters: number[];
  sides: SavedSide[];
  offset: number;
}

export interface Snapshots {
  save: (filter?: StateFilter) => Uint8Array;
  restore: (bytes: Uint8Array) => void;
  saveBody: (body: Jolt.Body) => Uint8Array;
  restoreBody: (body: Jolt.Body, bytes: Uint8Array) => void;
  saveObject: (
    object: Jolt.Constraint | Jolt.CharacterVirtual,
    side?: SideState,
  ) => Uint8Array;
  restoreObject: (
    object: Jolt.Constraint | Jolt.CharacterVirtual,
    bytes: Uint8Array,
    side?: SideState,
  ) => void;
  /** Carries a hook's JS state in every snapshot of its owner, until called off. */
  keep: (side: SideState) => () => void;
  destroy: () => void;
}

export const isSameState = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const describe = (ids: number[]) =>
  ids.length > 6
    ? `${ids.slice(0, 6).join(", ")} and ${ids.length - 6} more`
    : ids.join(", ");

const missing = (expected: number[], live: Set<number>) =>
  expected.filter((id) => !live.has(id));

/**
 * `saveState` / `restoreState`. Jolt's own stream holds the bodies, contacts
 * and the world's clock and gravity; constraints and characters are saved one
 * at a time after it, in `stateId` order. Jolt saves constraints by their slot
 * in the world, which mount order decides, and characters are not part of the
 * world at all.
 *
 * Ahead of all of it goes a header naming every body, constraint and character
 * by id, so a restore into a world that does not hold exactly those fails with
 * a list of what differs rather than writing one body's state into another.
 */
export const createSnapshots = (
  jolt: JoltModule,
  physicsSystem: Jolt.PhysicsSystem,
  stateIds: StateIdRegistry,
  constraints: ConstraintRegistry,
  timing: PhysicsTiming,
  flushEvents: () => void,
): Snapshots => {
  const bodyInterface = physicsSystem.GetBodyInterface();
  const writer = createStateWriter(jolt);
  const reader = createStateReader(jolt);
  const bodyIDs = new jolt.BodyIDVector();
  const sides = new Set<SideState>();

  const FULL =
    jolt.EStateRecorderState_Global |
    jolt.EStateRecorderState_Bodies |
    jolt.EStateRecorderState_Contacts;

  const liveBodies = () => {
    physicsSystem.GetBodies(bodyIDs);

    const all: number[] = [];
    const stated: number[] = [];
    const unstated: string[] = [];

    for (let index = 0; index < bodyIDs.size(); index += 1) {
      const id = bodyIDs.at(index);
      if (!bodyInterface.IsAdded(id)) continue;

      const value = id.GetIndexAndSequenceNumber();
      all.push(value);
      if (stateIds.isStated(id)) stated.push(value);
      else unstated.push(stateIds.hookOf(id) ?? "outside the hooks");
    }

    const ascending = (a: number, b: number) => a - b;
    return { all: all.sort(ascending), stated: stated.sort(ascending), unstated };
  };

  const requireStateIds = (
    action: string,
    unstated: string[],
    unkeyedConstraints: AttachedConstraint[],
    unkeyedCharacters: CharacterEntry[],
  ) => {
    const named = [
      ...unstated.map((hook) => `a body from ${hook}`),
      ...unkeyedConstraints.map((entry) => `a constraint from ${entry.hook}`),
      ...unkeyedCharacters.map((entry) => `a character from ${entry.hook}`),
    ];
    if (named.length === 0) return;

    const counts = new Map<string, number>();
    for (const name of named) counts.set(name, (counts.get(name) ?? 0) + 1);
    const listed = [...counts]
      .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
      .join(", ");

    throw new Error(
      `r3f-jolt: ${action} needs a \`stateId\` on everything in the world, and ` +
        `${named.length} ${named.length === 1 ? "thing has" : "things have"} ` +
        `none: ${listed}.`,
    );
  };

  const keyedConstraints = () =>
    constraints
      .attached()
      .filter((entry) => entry.stateId !== undefined)
      .sort((a, b) => (a.stateId ?? 0) - (b.stateId ?? 0));

  const keyedCharacters = () =>
    stateIds
      .characters()
      .filter((entry) => entry.stateId !== undefined)
      .sort((a, b) => (a.stateId ?? 0) - (b.stateId ?? 0));

  const encode = (header: Omit<Header, "offset">, segments: Uint8Array[]) => {
    const words =
      4 +
      2 +
      4 +
      header.bodies.length +
      header.constraints.length +
      header.characters.length;
    const size =
      words * 4 +
      header.sides.reduce(
        (total, side) => total + 12 + side.values.length * 8,
        0,
      ) +
      segments.reduce((total, segment) => total + 4 + segment.length, 0);

    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let at = 0;

    const u32 = (value: number) => {
      view.setUint32(at, value, true);
      at += 4;
    };
    const list = (values: number[]) => {
      u32(values.length);
      values.forEach(u32);
    };

    u32(MAGIC);
    u32(VERSION);
    u32(header.partial ? PARTIAL : 0);
    u32(header.stepCount);
    view.setFloat64(at, header.elapsed, true);
    at += 8;
    list(header.bodies);
    list(header.constraints);
    list(header.characters);

    u32(header.sides.length);
    for (const side of header.sides) {
      u32(side.tag);
      u32(side.id);
      u32(side.values.length);
      for (const value of side.values) {
        view.setFloat64(at, value, true);
        at += 8;
      }
    }

    for (const segment of segments) {
      u32(segment.length);
      bytes.set(segment, at);
      at += segment.length;
    }

    return bytes;
  };

  const decode = (bytes: Uint8Array): Header => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;

    const u32 = () => {
      const value = view.getUint32(at, true);
      at += 4;
      return value;
    };
    const list = () => Array.from({ length: u32() }, u32);
    const f64 = () => {
      const value = view.getFloat64(at, true);
      at += 8;
      return value;
    };
    const readSide = (): SavedSide => ({
      tag: u32(),
      id: u32(),
      values: Array.from({ length: u32() }, f64),
    });

    if (bytes.byteLength < 24 || u32() !== MAGIC || u32() !== VERSION) {
      throw new Error(
        "r3f-jolt: restoreState was given bytes that are not a snapshot from " +
          "this version of r3f-jolt.",
      );
    }

    const partial = (u32() & PARTIAL) !== 0;
    const stepCount = u32();
    const elapsed = f64();

    return {
      partial,
      stepCount,
      elapsed,
      bodies: list(),
      constraints: list(),
      characters: list(),
      sides: Array.from({ length: u32() }, readSide),
      offset: at,
    };
  };

  /** Registered order breaks ties, for two hooks on one owner. */
  const savedSides = (includes: (side: SideState) => boolean): SavedSide[] =>
    [...sides]
      .filter(includes)
      .map((side) => ({
        tag: SIDE_TAGS[side.tag],
        id: side.id >>> 0,
        values: side.save(),
      }))
      .sort((a, b) => a.tag - b.tag || a.id - b.id);

  const restoreSides = (saved: SavedSide[]) => {
    const live = [...sides];

    for (const record of saved) {
      const at = live.findIndex(
        (side) =>
          SIDE_TAGS[side.tag] === record.tag && side.id >>> 0 === record.id,
      );
      if (at === -1) continue;
      live.splice(at, 1)[0].restore(record.values);
    }
  };

  const saveWith = (selection: Selection) => {
    // Events still queued are ones the JS state saved below has not heard yet.
    flushEvents();
    constraints.order();

    const bodies = liveBodies();
    const constraintEntries = selection.partial
      ? keyedConstraints().filter(selection.constraint)
      : constraints.attached();
    const characterEntries = selection.partial
      ? keyedCharacters().filter(selection.character)
      : stateIds.characters();

    if (!selection.partial) {
      requireStateIds(
        "saveState",
        bodies.unstated,
        constraintEntries.filter((entry) => entry.stateId === undefined),
        characterEntries.filter((entry) => entry.stateId === undefined),
      );
    }

    const savedBodies = selection.partial
      ? bodies.all.filter(selection.body)
      : bodies.stated;

    if (selection.partial) {
      const wanted = new Set(savedBodies);
      const filter = new jolt.StateRecorderFilterJS();
      filter.ShouldSaveBody = function shouldSaveBody(body: number) {
        return wanted.has(
          jolt.wrapPointer(body, jolt.Body).GetID().GetIndexAndSequenceNumber(),
        );
      };
      filter.ShouldSaveConstraint = function shouldSaveConstraint() {
        return false;
      };
      filter.ShouldSaveContact = function shouldSaveContact() {
        return false;
      };
      filter.ShouldRestoreContact = function shouldRestoreContact() {
        return false;
      };
      physicsSystem.SaveState(
        writer.recorder,
        jolt.EStateRecorderState_Bodies,
        filter,
      );
      jolt.destroy(filter);
    } else {
      physicsSystem.SaveState(writer.recorder, FULL as Jolt.EStateRecorderState);
    }

    const segments = [writer.take()];
    const sortedConstraints = [...constraintEntries].sort(
      (a, b) => (a.stateId ?? 0) - (b.stateId ?? 0),
    );
    for (const entry of sortedConstraints) {
      entry.constraint.SaveState(writer.recorder);
      segments.push(writer.take());
    }
    const sortedCharacters = [...characterEntries].sort(
      (a, b) => (a.stateId ?? 0) - (b.stateId ?? 0),
    );
    for (const entry of sortedCharacters) {
      entry.character.SaveState(writer.recorder);
      segments.push(writer.take());
    }

    const constraintIds = sortedConstraints.map((entry) => entry.stateId ?? 0);
    const characterIds = sortedCharacters.map((entry) => entry.stateId ?? 0);
    const owners = {
      body: new Set(savedBodies),
      constraint: new Set(constraintIds),
      character: new Set(characterIds),
    };

    return encode(
      {
        partial: selection.partial,
        stepCount: timing.stepCount,
        elapsed: timing.elapsed,
        bodies: savedBodies,
        constraints: constraintIds,
        characters: characterIds,
        sides: savedSides((side) => owners[side.owner].has(side.id)),
      },
      segments,
    );
  };

  const save = (filter?: StateFilter) => {
    const stated = filter ? new Set(liveBodies().stated) : null;

    return saveWith(
      filter
        ? {
            partial: true,
            body: (value) =>
              (stated?.has(value) ?? false) && (filter.body?.(value) ?? false),
            constraint: (entry) =>
              filter.constraint?.(entry.stateId ?? 0) ?? false,
            character: (entry) =>
              filter.character?.(entry.stateId ?? 0) ?? false,
          }
        : {
            partial: false,
            body: () => true,
            constraint: () => true,
            character: () => true,
          },
    );
  };

  const compare = (
    kind: string,
    saved: number[],
    live: number[],
    partial: boolean,
  ) => {
    const liveSet = new Set(live);
    const absent = missing(saved, liveSet);
    const extra = partial ? [] : missing(live, new Set(saved));
    if (absent.length === 0 && extra.length === 0) return null;

    return [
      absent.length ? `${kind} ${describe(absent)} not in the world` : "",
      extra.length ? `${kind} ${describe(extra)} not in the snapshot` : "",
    ]
      .filter(Boolean)
      .join("; ");
  };

  const readSegment = (bytes: Uint8Array, at: number, run: () => void) => {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(at, true);
    reader.load(bytes, at + 4);
    run();

    if (reader.failed() || reader.position() !== at + 4 + length) {
      throw new Error(
        "r3f-jolt: restoreState read past a snapshot's end — the bytes are " +
          "damaged or were saved from a different build.",
      );
    }

    return at + 4 + length;
  };

  const restore = (bytes: Uint8Array, only?: number) => {
    const header = decode(bytes);

    if (
      only !== undefined &&
      (header.bodies.length !== 1 || header.bodies[0] !== only)
    ) {
      throw new Error(
        "r3f-jolt: restoreState on a body was given another body's snapshot.",
      );
    }

    constraints.order();

    const bodies = liveBodies();
    const constraintEntries = keyedConstraints();
    const characterEntries = keyedCharacters();

    if (!header.partial) {
      requireStateIds(
        "restoreState",
        bodies.unstated,
        constraints.attached().filter((entry) => entry.stateId === undefined),
        stateIds.characters().filter((entry) => entry.stateId === undefined),
      );
    }

    const differences = [
      compare(
        "bodies",
        header.bodies,
        header.partial ? bodies.all : bodies.stated,
        header.partial,
      ),
      compare(
        "constraints",
        header.constraints,
        constraintEntries.map((entry) => entry.stateId ?? 0),
        header.partial,
      ),
      compare(
        "characters",
        header.characters,
        characterEntries.map((entry) => entry.stateId ?? 0),
        header.partial,
      ),
    ].filter(Boolean);

    if (differences.length > 0) {
      throw new Error(
        "r3f-jolt: restoreState was given a snapshot of a different world " +
          `(by stateId): ${differences.join("; ")}.`,
      );
    }

    // Ahead of the stream: a posture changing the character's shape must not
    // overwrite the contacts and bounds the stream is about to put back.
    restoreSides(header.sides);

    let at = readSegment(bytes, header.offset, () => {
      if (!physicsSystem.RestoreState(reader.recorder)) {
        throw new Error("r3f-jolt: Jolt refused the snapshot's world state.");
      }
    });

    const constraintsById = new Map(
      constraintEntries.map((entry) => [entry.stateId, entry]),
    );
    for (const stateId of header.constraints) {
      const entry = constraintsById.get(stateId);
      at = readSegment(bytes, at, () =>
        entry?.constraint.RestoreState(reader.recorder),
      );
    }

    const charactersById = new Map(
      characterEntries.map((entry) => [entry.stateId, entry]),
    );
    for (const stateId of header.characters) {
      const entry = charactersById.get(stateId);
      at = readSegment(bytes, at, () =>
        entry?.character.RestoreState(reader.recorder),
      );
    }

    if (!header.partial) {
      timing.stepCount = header.stepCount;
      timing.elapsed = header.elapsed;
    }
    timing.restores += 1;
  };

  const saveBody = (body: Jolt.Body) => {
    const value = body.GetID().GetIndexAndSequenceNumber();
    return saveWith({
      partial: true,
      body: (other) => other === value,
      constraint: () => false,
      character: () => false,
    });
  };

  /** Laid out as a count of side values, the values, then Jolt's stream. */
  const saveObject = (
    object: Jolt.Constraint | Jolt.CharacterVirtual,
    side?: SideState,
  ) => {
    object.SaveState(writer.recorder);
    const stream = writer.take();
    const values = side?.save() ?? [];

    const bytes = new Uint8Array(4 + values.length * 8 + stream.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, values.length, true);
    values.forEach((value, index) =>
      view.setFloat64(4 + index * 8, value, true),
    );
    bytes.set(stream, 4 + values.length * 8);
    return bytes;
  };

  const restoreObject = (
    object: Jolt.Constraint | Jolt.CharacterVirtual,
    bytes: Uint8Array,
    side?: SideState,
  ) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = bytes.byteLength < 4 ? -1 : view.getUint32(0, true);
    const offset = 4 + count * 8;

    if (count < 0 || offset > bytes.length) {
      throw new Error(
        "r3f-jolt: restoreState was given bytes saved from a different kind " +
          "of object.",
      );
    }

    const values = Array.from({ length: count }, (_, index) =>
      view.getFloat64(4 + index * 8, true),
    );
    if (side && count > 0) side.restore(values);

    reader.load(bytes, offset);
    object.RestoreState(reader.recorder);

    if (reader.failed() || reader.position() !== bytes.length) {
      throw new Error(
        "r3f-jolt: restoreState was given bytes saved from a different kind " +
          "of object.",
      );
    }
    timing.restores += 1;
  };

  return {
    save,
    restore: (bytes) => restore(bytes),
    saveBody,
    restoreBody: (body, bytes) =>
      restore(bytes, body.GetID().GetIndexAndSequenceNumber()),
    saveObject,
    restoreObject,
    keep: (side) => {
      sides.add(side);
      return () => sides.delete(side);
    },
    destroy: () => {
      sides.clear();
      writer.destroy();
      reader.destroy();
      jolt.destroy(bodyIDs);
    },
  };
};
