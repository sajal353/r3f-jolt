import { useEffect, useRef, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Controls, Floor, Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useHingeConstraint } from "@/Jolt/useHingeConstraint";
import { useJolt } from "@/Jolt/useJolt";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { Vec3Tuple } from "@/Jolt/types";
import type Jolt from "jolt-physics";

/** Ten seconds of steps at 60 Hz. */
const HISTORY = 600;
const PIVOT: Vec3Tuple = [0, 8, 0];
const BALL_RADIUS = 0.8;
const BRICK: Vec3Tuple = [0.8, 0.5, 1.6];
const COLORS = ["#8e44ad", "#2980b9", "#16a085", "#d35400"];

const Brick = ({ stateId, position }: { stateId: number; position: Vec3Tuple }) => {
  const [ref] = useBox({
    stateId,
    position,
    size: BRICK,
    motionType: "dynamic",
    mass: 40,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={BRICK} />
      <meshStandardMaterial color={COLORS[stateId % COLORS.length]} />
    </mesh>
  );
};

const towerBricks = Array.from({ length: 14 }, (_, index) => ({
  stateId: index + 1,
  position: [
    2.2 + (index % 2) * BRICK[0],
    BRICK[1] / 2 + Math.floor(index / 2) * BRICK[1],
    0,
  ] as Vec3Tuple,
}));

type Ball = BodyApi<Jolt.Shape> | undefined;

const WreckingBall = ({ ballRef }: { ballRef: RefObject<Ball> }) => {
  const [ref, ball] = useSphere({
    stateId: 20,
    radius: BALL_RADIUS,
    position: [0, 2, 0],
    motionType: "dynamic",
    mass: 400,
  });

  useHingeConstraint(null, ball, {
    stateId: 1,
    point: PIVOT,
    hingeAxis: [0, 0, 1],
    normalAxis: [1, 0, 0],
  });

  useEffect(() => {
    ballRef.current = ball;
  }, [ball, ballRef]);

  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[BALL_RADIUS, 24, 16]} />
        <meshStandardMaterial color="#555" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={PIVOT}>
        <sphereGeometry args={[0.15, 12, 8]} />
        <meshStandardMaterial color="#aaa" />
      </mesh>
    </>
  );
};

/**
 * Steps the world itself, saving every step into a ring, so the scrub bar can
 * stop it and put any of those steps back. Playing on from a scrubbed step
 * drops the steps after it, as an editor's undo does.
 */
const Recorder = ({ ball }: { ball: RefObject<Ball> }) => {
  const api = useJolt();
  const history = useRef<Uint8Array[]>([]);
  const lastStep = useRef(-1);
  const saved = useRef<Uint8Array | null>(null);
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState({ index: 0, length: 0, bytes: 0 });

  useFrame(function recordSteps(_, delta) {
    if (!playing) return;

    api.step(Math.min(delta, 0.1));
    if (api.timing.stepCount === lastStep.current) return;
    lastStep.current = api.timing.stepCount;

    const snapshot = api.saveState();
    history.current.push(snapshot);
    if (history.current.length > HISTORY) history.current.shift();
    const length = history.current.length;
    setView({ index: length - 1, length, bytes: snapshot.length });
  });

  const scrub = (index: number) => {
    setPlaying(false);
    api.restoreState(history.current[index]);
    lastStep.current = api.timing.stepCount;
    setView((current) => ({ ...current, index }));
  };

  const play = () => {
    history.current.length = view.index + 1;
    setPlaying(true);
  };

  const load = () => {
    if (!saved.current) return;
    api.restoreState(saved.current);
    history.current = [saved.current];
    lastStep.current = api.timing.stepCount;
    setView({ index: 0, length: 1, bytes: saved.current.length });
  };

  return (
    <>
      <Hud position={[0, 11.4, 0]}>
        step {api.timing.stepCount} · {(view.bytes / 1024).toFixed(1)} KB a
        snapshot · {view.length} kept
      </Hud>
      <Controls position={[0, 10.4, 0]}>
        <button
          type="button"
          onClick={() => ball.current?.applyImpulse([-3500, 0, 0])}
        >
          swing
        </button>
        <button
          type="button"
          aria-pressed={playing}
          onClick={() => (playing ? setPlaying(false) : play())}
        >
          {playing ? "pause" : "play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(view.length - 1, 0)}
          value={view.index}
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <button
          type="button"
          onClick={() => {
            saved.current = history.current[view.index] ?? api.saveState();
          }}
        >
          save
        </button>
        <button type="button" onClick={load}>
          load
        </button>
      </Controls>
    </>
  );
};

export const SaveRestore = () => {
  const ball = useRef<Ball>(undefined);

  return (
    <>
      <Floor size={30} stateId={0} />
      {towerBricks.map((brick) => (
        <Brick key={brick.stateId} {...brick} />
      ))}
      <WreckingBall ballRef={ball} />
      <Recorder ball={ball} />
    </>
  );
};
