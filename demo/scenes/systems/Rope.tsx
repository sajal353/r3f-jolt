import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { CatmullRomCurve3, Vector3, type Curve } from "three";
import { useBox } from "@/Jolt/useBox";
import { useRope, type RopeApi, type UseRopeOptions } from "@/Jolt/useRope";
import type { Vec3Tuple } from "@/Jolt/types";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { Ball } from "../../shared/Ball";
import { useShots } from "../../shared/shots";

const POST_HEIGHT = 4;
const POST_LEFT = -7;
const POST_RIGHT = -3;
const PIN_HEIGHT = POST_HEIGHT - 0.25;
// Pins sit just off a post's face, so the rope never drapes over it.
const PIN_INSET = 0.15;
const BEAM_HEIGHT = 5;
const POLE_X = 0.5;
const ROOT_HEIGHT = BEAM_HEIGHT - 0.3;
const SIDE_OFFSET = 0.15;
const SPRING_BAR_X = 5;
const LEAD = 0.3;

type Register = (api: RopeApi) => () => void;

/** Lists a rope with the scene while it is mounted. */
const useRegistered = (api: RopeApi | undefined, register: Register) => {
  useEffect(() => {
    if (api) return register(api);
  }, [api, register]);
};

const Block = ({
  position,
  size,
  color = "#6d4c41",
}: {
  position: Vec3Tuple;
  size: Vec3Tuple;
  color?: string;
}) => {
  const [ref] = useBox({ position, size, motionType: "static" });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

/** Lines for the segments and dots for the vertices, from the same buffer. */
const Rope = ({
  color,
  onCreate,
  ...options
}: UseRopeOptions & { color: string; onCreate: Register }) => {
  const [ref, api] = useRope(options);
  useRegistered(api, onCreate);

  return (
    <group ref={ref}>
      {api && (
        <>
          <lineSegments geometry={api.geometry}>
            <lineBasicMaterial color={color} />
          </lineSegments>
          <points geometry={api.geometry}>
            <pointsMaterial color={color} size={0.07} />
          </points>
        </>
      )}
    </group>
  );
};

/** A pigtail: a straight lead down from the bar, then a helix. */
const pigtail = (x: number, z: number): Curve<Vector3> => {
  const root = BEAM_HEIGHT - 0.05;
  const points = [new Vector3(x, root, z)];
  for (let step = 0; step <= 48; step += 1) {
    const turn = (step / 48) * Math.PI * 2 * 4;
    points.push(
      new Vector3(
        x + Math.cos(turn) * 0.12 - 0.12,
        root - LEAD - step * 0.04,
        z + Math.sin(turn) * 0.12,
      ),
    );
  }
  return new CatmullRomCurve3(points);
};

export const RopeScene = () => {
  const [ropes, setRopes] = useState<RopeApi[]>([]);
  const [round, setRound] = useState(0);
  const [readout, setReadout] = useState("");
  const shots = useShots();
  const curls = useMemo(
    () => [pigtail(SPRING_BAR_X - 0.6, 0), pigtail(SPRING_BAR_X + 0.6, 0)],
    [],
  );

  const register = useMemo<Register>(
    () => (api) => {
      setRopes((current) => [...current, api]);
      return () => setRopes((current) => current.filter((rope) => rope !== api));
    },
    [],
  );

  const [catenary, setCatenary] = useState<RopeApi>();
  const registerCatenary = useMemo<Register>(
    () => (api) => {
      setCatenary(api);
      const unregister = register(api);
      return () => {
        setCatenary(undefined);
        unregister();
      };
    },
    [register],
  );

  useFrame(function readLength() {
    if (!catenary) return;
    const text = `rest ${catenary.restLength.toFixed(2)} m · now ${catenary.length().toFixed(2)} m`;
    if (text !== readout) setReadout(text);
  });

  // An impulse is shared by every vertex, so scale it to give each the same kick.
  const shove = () => {
    for (const rope of ropes) {
      rope.applyImpulse([0, rope.vertexCount, -2 * rope.vertexCount]);
    }
  };

  return (
    <>
      <Floor size={40} />

      <Block position={[POST_LEFT, POST_HEIGHT / 2, 0]} size={[0.2, POST_HEIGHT, 0.2]} />
      <Block position={[POST_RIGHT, POST_HEIGHT / 2, 0]} size={[0.2, POST_HEIGHT, 0.2]} />
      <Rope
        key={`catenary-${round}`}
        color="#f5cba7"
        onCreate={registerCatenary}
        points={[
          [POST_LEFT + PIN_INSET, PIN_HEIGHT, 0],
          [(POST_LEFT + POST_RIGHT) / 2, PIN_HEIGHT - 1.7, 0],
          [POST_RIGHT - PIN_INSET, PIN_HEIGHT, 0],
        ]}
        segments={40}
        pinned="both"
        lra="geodesic"
        iterations={10}
        linearDamping={0.3}
      />

      <Block position={[POLE_X, BEAM_HEIGHT / 2, 0]} size={[0.2, BEAM_HEIGHT, 0.2]} />
      {/*
        Built straight out either side of the pole: the hinged rope swings past
        it, the clamped cable holds.
      */}
      <Rope
        key={`hinged-${round}`}
        color="#e59866"
        onCreate={register}
        points={[
          [POLE_X, ROOT_HEIGHT, -SIDE_OFFSET],
          [POLE_X + 2, ROOT_HEIGHT, -SIDE_OFFSET],
        ]}
        segments={20}
        pinned="start"
        iterations={10}
        linearDamping={0.3}
      />
      <Rope
        key={`clamped-${round}`}
        color="#5dade2"
        onCreate={register}
        points={[
          [POLE_X, ROOT_HEIGHT, SIDE_OFFSET],
          [POLE_X + 2, ROOT_HEIGHT, SIDE_OFFSET],
        ]}
        segments={20}
        pinned="start"
        clamp
        bendCompliance={1e-5}
        iterations={10}
        radius={0.04}
      />

      <Block
        position={[SPRING_BAR_X, BEAM_HEIGHT + 0.1, 0]}
        size={[2.2, 0.2, 0.2]}
        color="#7f8c8d"
      />
      {curls.map((curve, index) => (
        <Rope
          key={`curl-${round}-${index}`}
          color={index === 0 ? "#af7ac5" : "#bdc3c7"}
          onCreate={register}
          curve={curve}
          segments={60}
          pinned="start"
          clamp
          curl={index === 0}
          bendCompliance={1e-4}
          iterations={10}
          linearDamping={0.5}
        />
      ))}

      {shots.map((shot) => (
        <Ball key={shot.id} shot={shot} />
      ))}

      <Tag position={[(POST_LEFT + POST_RIGHT) / 2, POST_HEIGHT + 0.7, 0]}>
        catenary · lra
      </Tag>
      <Tag position={[POLE_X + 1, BEAM_HEIGHT + 0.5, 0]}>hinged · clamp</Tag>
      <Tag position={[SPRING_BAR_X, BEAM_HEIGHT + 0.7, 0]}>curl · straight</Tag>

      <Controls position={[0, 6.6, 0]}>
        <button onClick={shove}>shove</button>
        <button onClick={() => setRound((count) => count + 1)}>rebuild</button>
      </Controls>
      <Hud position={[(POST_LEFT + POST_RIGHT) / 2, 1.2, 0]}>{readout}</Hud>
    </>
  );
};
