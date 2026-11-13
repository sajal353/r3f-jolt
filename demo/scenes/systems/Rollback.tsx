import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Hud, Tag } from "../../shared/Stage";
import { Physics } from "@/Jolt/Physics";
import { useBeforePhysicsStep } from "@/Jolt/useBeforePhysicsStep";
import { useBox } from "@/Jolt/useBox";
import { useJolt } from "@/Jolt/useJolt";
import { useRollback } from "@/Jolt/useRollback";
import { useSphere } from "@/Jolt/useSphere";
import type { Vec3Tuple } from "@/Jolt/types";
import { createLink, type Input, type Link, type Player } from "./rollbackLink";

/** Three seconds at 60 Hz, far more than the slider's longest latency. */
const HISTORY = 180;
const ARENA = 12;
const FORCE = 700;
const PEER_OFFSET = 8;
const COLORS = ["#e74c3c", "#3498db"];
const STILL = { x: 0, z: 0 };

const WALLS: { stateId: number; position: Vec3Tuple; size: Vec3Tuple }[] = [
  { stateId: 1, position: [0, 0.5, -ARENA / 2], size: [ARENA, 1, 0.4] },
  { stateId: 2, position: [0, 0.5, ARENA / 2], size: [ARENA, 1, 0.4] },
  { stateId: 3, position: [-ARENA / 2, 0.5, 0], size: [0.4, 1, ARENA] },
  { stateId: 4, position: [ARENA / 2, 0.5, 0], size: [0.4, 1, ARENA] },
];

const CRATES: { stateId: number; position: Vec3Tuple }[] = [
  { stateId: 5, position: [0, 0.5, 0] },
  { stateId: 6, position: [0, 1.5, 0] },
  { stateId: 7, position: [2.5, 0.5, 2] },
  { stateId: 8, position: [-2.5, 0.5, -2] },
  { stateId: 9, position: [2.5, 0.5, -2.5] },
  { stateId: 10, position: [-2.5, 0.5, 2.5] },
];

const Slab = ({
  stateId,
  position,
  size,
  color,
}: {
  stateId: number;
  position: Vec3Tuple;
  size: Vec3Tuple;
  color: string;
}) => {
  const [ref] = useBox({ stateId, position, size, motionType: "static" });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Crate = ({ stateId, position }: { stateId: number; position: Vec3Tuple }) => {
  const [ref] = useBox({
    stateId,
    position,
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 15,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#c9a227" />
    </mesh>
  );
};

/** The input in force at `step`: the newest change not after it. */
const inputAt = (changes: Input[], step: number) => {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    if (changes[index].step <= step) return changes[index];
  }
  return STILL;
};

const insert = (changes: Input[], change: Input) => {
  let at = changes.length;
  while (at > 0 && changes[at - 1].step > change.step) at -= 1;
  changes.splice(at, 0, change);
};

/**
 * One peer's whole game: its own world, its own step clock. Its own player's
 * input applies at once; the other's is predicted by holding the last one
 * heard. When the real one arrives, `rewind` goes back to its step and the
 * world runs forward again knowing it.
 */
const Game = ({ me, link }: { me: Player; link: Link }) => {
  const api = useJolt();
  const rollback = useRollback({ capacity: HISTORY });
  const [timelines] = useState<[Input[], Input[]]>(() => [[], []]);

  const [redRef, red] = useSphere({
    stateId: 11,
    radius: 0.6,
    position: [-3.5, 0.6, 0],
    motionType: "dynamic",
    mass: 30,
  });
  const [blueRef, blue] = useSphere({
    stateId: 12,
    radius: 0.6,
    position: [3.5, 0.6, 0],
    motionType: "dynamic",
    mass: 30,
  });

  useBeforePhysicsStep(function applyInputs(_, step) {
    if (!api.timing.resimulating) {
      const wanted = link.sample(me, step);
      const held = inputAt(timelines[me], step);

      if (wanted.x !== held.x || wanted.z !== held.z) {
        const change = { step, ...wanted };
        insert(timelines[me], change);
        link.send(me, change);
      }
    }

    const [redInput, blueInput] = timelines.map((changes) =>
      inputAt(changes, step),
    );
    if (redInput.x || redInput.z) {
      red?.applyForce([redInput.x * FORCE, 0, redInput.z * FORCE]);
    }
    if (blueInput.x || blueInput.z) {
      blue?.applyForce([blueInput.x * FORCE, 0, blueInput.z * FORCE]);
    }
  });

  useEffect(
    () =>
      link.join(me, {
        api,
        rollback,
        receive: function receive(from, input) {
          insert(timelines[from], input);

          const back = api.timing.stepCount - input.step;
          if (back <= 0) return;

          if (rollback.rewind(input.step)) {
            link.stats.rollbacks += 1;
            link.stats.resimulated += back;
          } else {
            link.stats.tooLate += 1;
          }
        },
      }),
    [api, link, me, rollback, timelines],
  );

  return (
    <>
      <Slab stateId={0} position={[0, -0.5, 0]} size={[ARENA, 1, ARENA]} color="#2a2a2a" />
      {WALLS.map((wall) => (
        <Slab key={wall.stateId} {...wall} color="#3a3a3a" />
      ))}
      {CRATES.map((crate) => (
        <Crate key={crate.stateId} {...crate} />
      ))}
      <mesh ref={redRef} castShadow>
        <sphereGeometry args={[0.6, 24, 16]} />
        <meshStandardMaterial color={COLORS[0]} />
      </mesh>
      <mesh ref={blueRef} castShadow>
        <sphereGeometry args={[0.6, 24, 16]} />
        <meshStandardMaterial color={COLORS[1]} />
      </mesh>
    </>
  );
};

/** Two worlds side by side, each stepping itself. */
export const Peers = ({ link }: { link: Link }) =>
  ([0, 1] as const).map((me) => (
    <group key={me} position={[(me === 0 ? -1 : 1) * PEER_OFFSET, 0, 0]}>
      <Physics updateLoop="fixed" timeStep={1 / 60}>
        <Game me={me} link={link} />
      </Physics>
    </group>
  ));

const Readout = ({ link }: { link: Link }) => {
  const [stats, setStats] = useState({ ...link.stats });
  const sinceCheck = useRef(0);

  useFrame(function refreshReadout(_, delta) {
    sinceCheck.current += delta;
    if (sinceCheck.current < 0.25) return;
    sinceCheck.current = 0;

    link.check();
    setStats({ ...link.stats });
  });

  return (
    <Hud position={[0, 7, 0]}>
      {stats.rollbacks} rollbacks · {stats.resimulated} steps re-run ·{" "}
      {stats.checks - stats.diverged} of {stats.checks} comparisons identical
      {stats.tooLate > 0 && ` · ${stats.tooLate} too late`}
    </Hud>
  );
};

export const RollbackNetcode = () => {
  const [link] = useState(createLink);
  const [latency, setLatency] = useState(link.latency);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (["w", "a", "s", "d"].includes(event.key)) {
        link.press(event.key, event.type === "keydown");
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      link.close();
    };
  }, [link]);

  return (
    <>
      <Peers link={link} />
      <Readout link={link} />
      <Tag position={[-PEER_OFFSET, 3.5, 0]}>peer 1: red is yours</Tag>
      <Tag position={[PEER_OFFSET, 3.5, 0]}>peer 2: blue is yours</Tag>
      <Controls position={[0, 6, 0]}>
        <label>
          latency {latency} ms{" "}
          <input
            type="range"
            min={0}
            max={400}
            step={10}
            value={latency}
            onChange={(event) => {
              const next = Number(event.target.value);
              link.setLatency(next);
              setLatency(next);
            }}
          />
        </label>
      </Controls>
    </>
  );
};
