import type Jolt from "jolt-physics";
import type { JoltModule } from "../types";

export interface StateWriter {
  recorder: Jolt.StateRecorderJS;
  /** Starts over at the beginning of the writer's buffer. */
  clear: () => void;
  /**
   * Bytes written since the last `clear`, as a view of the writer's own buffer:
   * read it before the next write, which may move it.
   */
  written: () => Uint8Array;
  destroy: () => void;
}

export interface StateReader {
  recorder: Jolt.StateRecorderJS;
  /** Points the reader at `bytes` from `offset`; Jolt then reads through it. */
  load: (bytes: Uint8Array, offset: number) => void;
  /** Where Jolt stopped reading, so what follows can be read by hand. */
  position: () => number;
  failed: () => boolean;
  destroy: () => void;
}

/**
 * `StateRecorderImpl` binds no accessor for its bytes, so a snapshot that has
 * to leave WASM goes through `StateRecorderJS`: Jolt hands over a pointer and a
 * length per value, and they are copied through `HEAPU8` — re-read on every
 * call, since the heap is replaced when it grows. A save makes a call for
 * every value, so the copy is a loop rather than a `subarray` view per call.
 */
export const createStateWriter = (jolt: JoltModule): StateWriter => {
  let buffer = new Uint8Array(4096);
  let length = 0;

  const recorder = new jolt.StateRecorderJS();

  recorder.WriteBytes = function writeBytes(data: number, count: number) {
    if (length + count > buffer.length) {
      const grown = new Uint8Array(Math.max(buffer.length * 2, length + count));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    }

    const heap = jolt.HEAPU8;
    for (let index = 0; index < count; index += 1) {
      buffer[length + index] = heap[data + index];
    }
    length += count;
  };
  recorder.ReadBytes = function readBytes() {};
  recorder.IsEOF = function isEOF() {
    return false;
  };
  recorder.IsFailed = function isFailed() {
    return false;
  };

  return {
    recorder,
    clear: () => {
      length = 0;
    },
    written: () => buffer.subarray(0, length),
    destroy: () => jolt.destroy(recorder),
  };
};

export const createStateReader = (jolt: JoltModule): StateReader => {
  let source: Uint8Array = new Uint8Array(0);
  let cursor = 0;
  let failed = false;

  const recorder = new jolt.StateRecorderJS();

  recorder.WriteBytes = function writeBytes() {};
  recorder.ReadBytes = function readBytes(data: number, count: number) {
    if (cursor + count > source.length) {
      failed = true;
      jolt.HEAPU8.fill(0, data, data + count);
      return;
    }

    const heap = jolt.HEAPU8;
    for (let index = 0; index < count; index += 1) {
      heap[data + index] = source[cursor + index];
    }
    cursor += count;
  };
  recorder.IsEOF = function isEOF() {
    return cursor >= source.length;
  };
  recorder.IsFailed = function isFailed() {
    return failed;
  };

  return {
    recorder,
    load: (bytes, offset) => {
      source = bytes;
      cursor = offset;
      failed = false;
    },
    position: () => cursor,
    failed: () => failed,
    destroy: () => {
      source = new Uint8Array(0);
      jolt.destroy(recorder);
    },
  };
};
