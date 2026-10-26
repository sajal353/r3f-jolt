import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { Controls, Floor, Tag, Wall } from "../../shared/Stage";
import { useMannequin } from "../../shared/mannequin";
import { useSphere } from "@/Jolt/useSphere";
import { useCharacterModel } from "@/Jolt/useCharacterModel";
import { useRagdoll } from "@/Jolt/useRagdoll";
import type { Vec3Tuple } from "@/Jolt/types";

const LEGS = ["pelvis", "thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"];

/** Dropped limp onto the steps, again every few seconds. */
const Faller = () => {
  const { character, mixer } = useMannequin(
    [-5, 4.2, -0.5],
    "Idle_Loop",
    [-0.6, 0.4, 0.3],
  );
  const model = useCharacterModel(character);
  useRagdoll(model, { mode: "passive", mixer });

  return <primitive object={character} />;
};

/** Idles on joint motors with its legs kinematic: shots knock it about and it recovers. */
const Reactor = () => {
  const { character, mixer } = useMannequin([0, 0, 0], "Idle_Loop");
  const model = useCharacterModel(character);
  useRagdoll(model, {
    mode: "motors",
    mixer,
    motorStrength: 6,
    kinematicBones: LEGS,
  });

  return <primitive object={character} />;
};

const KNOCKED_SECONDS = 2.5;

/**
 * Walks in place, hard keyed. Knocked down it goes limp, then gets up with a
 * get-up clip picked for how it landed — on its back or on its front — and
 * walks on.
 */
const Walker = ({ knock }: { knock: number }) => {
  const { character, mixer, getUp } = useMannequin([5, 0, 0], "Walk_Loop", [
    0,
    -Math.PI / 2,
    0,
  ]);
  const model = useCharacterModel(character);
  const [ragdoll] = useRagdoll(model, { mode: "hardKeying", mixer });
  const down = useRef<number | null>(null);

  useEffect(() => {
    if (knock === 0 || !ragdoll) return;
    ragdoll.setMode("passive");
    ragdoll.applyImpulse([60, 20, 0], "spine_03");
    down.current = 0;
  }, [knock, ragdoll]);

  useFrame(function getUpWhenDone(_, delta) {
    if (down.current === null || !ragdoll) return;
    down.current += delta;
    if (down.current < KNOCKED_SECONDS) return;

    down.current = null;
    getUp(ragdoll, "Walk_Loop");
  });

  return <primitive object={character} />;
};

const Steps = () => (
  <>
    {[0, 1, 2, 3].map((index) => (
      <Wall
        key={index}
        position={[-5, 0.2 + index * 0.4, -1 - index * 0.7]}
        size={[2.4, 0.4 + index * 0.8, 0.7]}
      />
    ))}
  </>
);

const SHOT_RADIUS = 0.15;
const SHOT_MASS = 4;
const SHOT_SPEED = 22;
const SHOT_CAP = 12;
const CLICK_SLOP = 6;
const DROP_SECONDS = 6;

interface Shot {
  id: number;
  position: Vec3Tuple;
  velocity: Vec3Tuple;
}

const Ball = ({ shot }: { shot: Shot }) => {
  const [ref] = useSphere({
    radius: SHOT_RADIUS,
    position: shot.position,
    motionType: "dynamic",
    mass: SHOT_MASS,
    initialVelocity: shot.velocity,
    motionQuality: "linearCast",
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[SHOT_RADIUS, 16, 16]} />
      <meshStandardMaterial color="#d0d3d4" metalness={0.5} roughness={0.3} />
    </mesh>
  );
};

/** A click (not a drag, which orbits) throws a ball from the camera. */
const useShots = () => {
  const canvas = useThree((state) => state.gl.domElement);
  const camera = useThree((state) => state.camera);
  const raycaster = useThree((state) => state.raycaster);
  const [shots, setShots] = useState<Shot[]>([]);
  const nextID = useRef(0);

  useEffect(() => {
    const down = { x: 0, y: 0 };

    const onDown = (event: PointerEvent) => {
      down.x = event.clientX;
      down.y = event.clientY;
    };

    const onUp = (event: PointerEvent) => {
      const travel = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (travel > CLICK_SLOP) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const origin = raycaster.ray.origin
        .clone()
        .addScaledVector(raycaster.ray.direction, 1);
      const velocity = raycaster.ray.direction.clone().multiplyScalar(SHOT_SPEED);
      nextID.current += 1;
      const shot: Shot = {
        id: nextID.current,
        position: [origin.x, origin.y, origin.z],
        velocity: [velocity.x, velocity.y, velocity.z],
      };

      setShots((current) => [
        ...current.slice(Math.max(0, current.length - (SHOT_CAP - 1))),
        shot,
      ]);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [canvas, camera, raycaster]);

  return shots;
};

export const RagdollScene = () => {
  const shots = useShots();
  const [drop, setDrop] = useState(0);
  const [knock, setKnock] = useState(0);
  const sinceDrop = useRef(0);

  useFrame(function redrop(_, delta) {
    sinceDrop.current += delta;
    if (sinceDrop.current < DROP_SECONDS) return;
    sinceDrop.current = 0;
    setDrop((count) => count + 1);
  });

  const knockDown = () => setKnock((count) => count + 1);

  return (
    <>
      <Floor size={40} />
      <Steps />

      <Faller key={drop} />
      <Reactor />
      <Walker knock={knock} />

      {shots.map((shot) => (
        <Ball key={shot.id} shot={shot} />
      ))}

      <Tag position={[-5, 3.6, 0]}>passive</Tag>
      <Tag position={[0, 2.3, 0]}>motors · legs kinematic</Tag>
      <Tag position={[5, 2.3, 0]}>hardKeying → passive → get-up clip</Tag>

      <Controls position={[5, 2.8, 0]}>
        <button onClick={knockDown}>knock down</button>
      </Controls>
    </>
  );
};
