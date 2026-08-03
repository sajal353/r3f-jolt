import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Hud } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useJolt } from "@/Jolt/useJolt";

const Floor = () => {
  const [ref] = useBox({
    position: [0, -0.5, 0],
    size: [40, 1, 40],
    motionType: "static",
    material: { friction: 0.8 },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[40, 1, 40]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  );
};

const REACH = 5;

/**
 * Driven with `moveKinematic`, which is what lets it carry the crate. Setting
 * the transform directly would teleport it with no velocity, and the crate would
 * be left behind on the spot.
 */
const Platform = () => {
  const [ref, api] = useBox({
    position: [0, 1, 0],
    size: [6, 0.4, 4],
    motionType: "kinematic",
    material: { friction: 1 },
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;
    elapsed.current += delta;
    api.moveKinematic(
      [Math.sin(elapsed.current * 0.6) * REACH, 1, 0],
      [0, 0, 0, 1],
    );
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[6, 0.4, 4]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Crate = ({ position }: { position: [number, number, number] }) => {
  const [ref] = useBox({
    position,
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 5,
    material: { friction: 1 },
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#e67e22" />
    </mesh>
  );
};

/**
 * A sensor reports contacts and imparts no impulse, so the balls fall straight
 * through it. `collideKinematicVsNonDynamic` would additionally let it notice
 * the platform.
 */
const Trigger = ({ onCount }: { onCount: (n: number) => void }) => {
  const [ref, api] = useBox({
    position: [-8, 2, 0],
    size: [4, 4, 4],
    motionType: "static",
    sensor: true,
  });

  const count = useRef(0);

  useBodyContacts(api?.body, {
    onEnter: () => {
      count.current += 1;
      onCount(count.current);
    },
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[4, 4, 4]} />
      <meshStandardMaterial color="#27ae60" transparent opacity={0.18} />
    </mesh>
  );
};

const DROP_MS = 900;

// One drop every 900 ms, so this is roughly fifteen seconds on screen before the
// oldest ball is unmounted — long enough to watch one settle rather than blink out.
const LIVE_BALLS = 17;

const Dropper = () => {
  const [balls, setBalls] = useState<number[]>([]);
  const next = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      next.current += 1;
      const id = next.current;
      setBalls((current) => [...current.slice(-(LIVE_BALLS - 1)), id]);
    }, DROP_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {balls.map((id) => (
        <Ball key={id} />
      ))}
    </>
  );
};

const Ball = () => {
  const [ref] = useSphere({
    radius: 0.35,
    position: [-8, 8, 0],
    motionType: "dynamic",
    mass: 1,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 20, 20]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

/**
 * A body the library never created, with no mesh of its own. It is invisible
 * until `<PhysicsDebug />` is on — the per-hook `debug` flag cannot draw it,
 * because no hook knows it exists. Balls still bounce off it.
 */
const HandmadeWall = () => {
  const api = useJolt();

  useEffect(() => {
    const { Jolt: jolt, bodyInterface, layers } = api;

    const halfExtent = new jolt.Vec3(0.5, 1.5, 3);
    const shape = new jolt.BoxShape(halfExtent, 0.05, undefined);
    jolt.destroy(halfExtent);
    shape.AddRef();

    const position = new jolt.RVec3(8, 1.5, 0);
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const settings = new jolt.BodyCreationSettings(
      shape,
      position,
      rotation,
      jolt.EMotionType_Static,
      layers.LAYER_NON_MOVING,
    );

    const body = bodyInterface.CreateBody(settings);
    jolt.destroy(settings);
    jolt.destroy(position);
    jolt.destroy(rotation);
    shape.Release();

    bodyInterface.AddBody(body.GetID(), jolt.EActivation_DontActivate);

    return () => {
      if (api.state.destroyed) return;
      bodyInterface.RemoveBody(body.GetID());
      bodyInterface.DestroyBody(body.GetID());
    };
  }, [api]);

  return null;
};

export const Kinematic = () => {
  const [triggered, setTriggered] = useState(0);

  return (
    <>
      <Floor />
      <Platform />
      <Crate position={[-1, 2, 0]} />
      <Crate position={[1.2, 2, 0.6]} />
      <Trigger onCount={setTriggered} />
      <Dropper />
      <HandmadeWall />

      <Hud position={[0, 7, 0]}>
        sensor entries: {triggered} · the wall on the right has no mesh — turn
        on PhysicsDebug
      </Hud>
    </>
  );
};
