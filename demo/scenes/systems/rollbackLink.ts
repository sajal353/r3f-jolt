import { isSameState } from "@/Jolt/internal/snapshot";
import type { RollbackApi } from "@/Jolt/useRollback";
import type { JoltApi } from "@/Jolt/types";

export type Player = 0 | 1;

/** A change of a player's direction, from the step it takes effect. */
export interface Input {
  step: number;
  x: number;
  z: number;
}

export interface Peer {
  api: JoltApi;
  rollback: RollbackApi;
  receive: (from: Player, input: Input) => void;
}

const ROAM = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [-0.7, -0.7],
  [0.7, -0.7],
];
const ROAM_STEPS = 70;
/** Nothing moves until both worlds have had a second to settle. */
const FIRST_MOVE = 60;
const NOT_MOVING = { x: 0, z: 0 };

/** An input is final once it can no longer be in flight: past the longest latency. */
export const SETTLED_STEPS = 36;

/**
 * Stands in for a network: each message reaches the other peer `latency`
 * milliseconds after it is sent. Both peers run in this page, on clocks of
 * their own, and share nothing else.
 */
export const createLink = () => {
  const peers: (Peer | null)[] = [null, null];
  const keys = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stats = { rollbacks: 0, resimulated: 0, tooLate: 0, checks: 0, diverged: 0 };
  let latency = 150;
  let keysUsed = false;

  const roam = (player: Player, step: number) => {
    if (step < FIRST_MOVE) return NOT_MOVING;
    const [x, z] = ROAM[(Math.floor(step / ROAM_STEPS) + player * 3) % ROAM.length];
    return { x, z };
  };

  const fromKeys = () => {
    const x = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    const z = (keys.has("s") ? 1 : 0) - (keys.has("w") ? 1 : 0);
    return { x, z };
  };

  return {
    stats,
    get latency() {
      return latency;
    },
    setLatency: (milliseconds: number) => {
      latency = milliseconds;
    },
    join: (player: Player, peer: Peer) => {
      peers[player] = peer;
      return () => {
        peers[player] = null;
      };
    },
    /** What this player's own peer reads for it, from the keys or else a roam. */
    sample: (player: Player, step: number) =>
      player === 0 && keysUsed ? fromKeys() : roam(player, step),
    press: (key: string, down: boolean) => {
      if (down) keys.add(key);
      else keys.delete(key);
      keysUsed = true;
    },
    send: (from: Player, input: Input) => {
      const timer = setTimeout(function deliver() {
        timers.delete(timer);
        peers[from === 0 ? 1 : 0]?.receive(from, input);
      }, latency);
      timers.add(timer);
    },
    /** Both peers' snapshots of a step whose inputs have all arrived must match. */
    check: () => {
      const [a, b] = peers;
      if (!a || !b) return;

      const settled =
        Math.min(a.api.timing.stepCount, b.api.timing.stepCount) - SETTLED_STEPS;
      const first = a.rollback.snapshotAt(settled);
      const second = b.rollback.snapshotAt(settled);
      if (!first || !second) return;

      stats.checks += 1;
      if (!isSameState(first, second)) stats.diverged += 1;
    },
    close: () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
};

export type Link = ReturnType<typeof createLink>;
