import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Floor, Hud, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useContactListener } from "@/Jolt/useContactListener";

const BOUNCY = 1;
const DEAD = 2;
const GHOST = 3;

const Pad = ({
  x,
  userData,
  color,
  label,
}: {
  x: number;
  userData: number;
  color: string;
  label: string;
}) => {
  const [ref] = useBox({
    position: [x, 0.25, 0],
    size: [3, 0.5, 3],
    motionType: "static",
    userData,
  });

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[3, 0.5, 3]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Tag position={[x, 1.6, 0]}>{label}</Tag>
    </>
  );
};

const Dropper = ({ x }: { x: number }) => {
  const [balls, setBalls] = useState<number[]>([]);
  const next = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      next.current += 1;
      setBalls((current) => [...current.slice(-3), next.current]);
    }, 1100);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {balls.map((id) => (
        <Ball key={id} x={x} />
      ))}
    </>
  );
};

const Ball = ({ x }: { x: number }) => {
  const [ref] = useSphere({
    radius: 0.35,
    position: [x, 8, 0],
    motionType: "dynamic",
    mass: 1,
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 18, 18]} />
      <meshStandardMaterial color="#ecf0f1" />
    </mesh>
  );
};

interface Counts {
  validated: number;
  added: number;
  rejected: number;
}

const SAMPLE_SECONDS = 0.25;

/**
 * The listener runs inside the step and fires far more often than a frame does,
 * so it counts into a ref and this publishes a snapshot a few times a second.
 * Calling `setState` from the callback itself would re-render mid-step.
 */
const Sampler = ({
  counts,
  onSample,
}: {
  counts: { current: Counts };
  onSample: (counts: Counts) => void;
}) => {
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < SAMPLE_SECONDS) return;

    elapsed.current = 0;
    onSample({ ...counts.current });
  });

  return null;
};

export const RawListener = () => {
  const [stats, setStats] = useState<Counts>({
    validated: 0,
    added: 0,
    rejected: 0,
  });
  const counts = useRef<Counts>({ validated: 0, added: 0, rejected: 0 });

  /**
   * The raw listener runs **inside** the step. Its arguments are live Jolt
   * objects, so nothing here may be retained, and no body may be created or
   * destroyed. What it *can* do is change the contact before it is solved.
   */
  useContactListener({
    onContactValidate: (body1, body2) => {
      counts.current.validated += 1;

      // Reject every contact with the ghost pad, so balls fall through it.
      const ghost =
        body1.GetUserData() === GHOST || body2.GetUserData() === GHOST;

      if (ghost) counts.current.rejected += 1;
      return !ghost;
    },

    onContactAdded: (body1, body2, _manifold, settings) => {
      counts.current.added += 1;

      const bouncy =
        body1.GetUserData() === BOUNCY || body2.GetUserData() === BOUNCY;
      const dead = body1.GetUserData() === DEAD || body2.GetUserData() === DEAD;

      // Overriding the solved material, per contact.
      if (bouncy) settings.mCombinedRestitution = 0.95;
      if (dead) settings.mCombinedRestitution = 0;
    },
  });

  return (
    <>
      <Floor size={50} />

      <Pad
        x={-5}
        userData={BOUNCY}
        color="#27ae60"
        label="restitution → 0.95"
      />
      <Pad x={0} userData={DEAD} color="#c0392b" label="restitution → 0" />
      <Pad x={5} userData={GHOST} color="#7f8c8d" label="contacts rejected" />

      <Dropper x={-5} />
      <Dropper x={0} />
      <Dropper x={5} />

      <Sampler counts={counts} onSample={setStats} />

      <Hud position={[0, 9, 0]}>
        validated {stats.validated} · added {stats.added} · rejected{" "}
        {stats.rejected}
      </Hud>
    </>
  );
};
