import { useCallback, useEffect, useRef, useState } from "react";
import {
  useFrame,
  useStore,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { Hud } from "../../shared/Stage";
import { Plane, Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import type { BodyApi } from "@/Jolt/internal/useBody";

type Grabbable = BodyApi<Jolt.Shape>;

const UPRIGHT: [number, number, number, number] = [0, 0, 0, 1];

const Floor = () => {
  const [ref] = useBox({
    position: [0, -0.5, 0],
    size: [40, 1, 40],
    motionType: "static",
    material: { friction: 0.6 },
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[40, 1, 40]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  );
};

/**
 * A pointer stands in for an XR controller here so the scene runs on a desktop.
 * Nothing below is XR-specific: the same three calls — `grab`, `moveTo`,
 * `release` — are what a controller would drive. The library deliberately owns
 * no input.
 */
const Prop = ({
  position,
  color,
  onGrab,
  heldApi,
}: {
  position: [number, number, number];
  color: string;
  onGrab: (api: Grabbable | undefined) => void;
  heldApi: Grabbable | undefined;
}) => {
  const [ref, api] = useBox({
    size: [1, 1, 1],
    position,
    motionType: "dynamic",
    mass: 4,
    material: { friction: 0.5, restitution: 0.2 },
  });

  const [scale, setScale] = useState(1);
  const grabbed = api !== undefined && api === heldApi;

  useEffect(() => {
    if (!api || !grabbed) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;

      setScale((current) => {
        const next = Math.min(
          3,
          Math.max(0.4, current + (event.key === "]" ? 0.2 : -0.2)),
        );
        api.setScale([next, next, next]);
        return next;
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, grabbed]);

  return (
    <mesh
      ref={ref}
      castShadow
      scale={scale}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onGrab(api);
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={grabbed ? "#f1c40f" : color}
        emissive={grabbed ? "#5a4a00" : "#000000"}
      />
    </mesh>
  );
};

const Bystander = ({ position }: { position: [number, number, number] }) => {
  const [ref] = useSphere({
    radius: 0.5,
    position,
    motionType: "dynamic",
    mass: 2,
    material: { restitution: 0.4 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshStandardMaterial color="#3498db" />
    </mesh>
  );
};

export const GrabAndScale = () => {
  const camera = useThree((state) => state.camera);
  const raycaster = useThree((state) => state.raycaster);
  const store = useStore();

  const [held, setHeld] = useState<Grabbable | undefined>();
  const heldRef = useRef<Grabbable | undefined>(undefined);

  const pointer = useRef(new Vector3());
  const dragPlane = useRef(new Plane(new Vector3(0, 0, 1), 0));

  const grab = useCallback(
    (api: Grabbable | undefined) => {
      if (!api || heldRef.current) return;

      api.grab();
      heldRef.current = api;
      setHeld(api);

      // Drag in the plane facing the camera through the body's current spot.
      const from = api.body.GetPosition();
      dragPlane.current.setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new Vector3()).negate(),
        new Vector3(from.GetX(), from.GetY(), from.GetZ()),
      );
    },
    [camera],
  );

  const release = useCallback(() => {
    const api = heldRef.current;
    if (!api) return;

    // No impulse here on purpose: the velocity the carry implied is already on
    // the body, so letting go *is* the throw.
    api.release();
    heldRef.current = undefined;
    setHeld(undefined);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", release);
    return () => window.removeEventListener("pointerup", release);
  }, [release]);

  // OrbitControls is `makeDefault`, so it is in the R3F store and can be turned
  // off for the duration of a carry. Otherwise the same drag orbits the camera
  // and moves the body, and the body chases a pointer ray that is itself moving.
  useEffect(() => {
    const orbit = store.getState().controls as { enabled: boolean } | null;
    if (!orbit) return;

    orbit.enabled = held === undefined;

    return () => {
      orbit.enabled = true;
    };
  }, [store, held]);

  useFrame(() => {
    const api = heldRef.current;
    if (!api) return;

    if (!raycaster.ray.intersectPlane(dragPlane.current, pointer.current)) {
      return;
    }

    // moveTo, not setPositionAndRotation: a teleport carries no velocity, so the
    // body would push nothing while held and drop straight down on release.
    api.moveTo(pointer.current, UPRIGHT);
  });

  return (
    <>
      <Floor />

      <Prop
        position={[-2.5, 1, 0]}
        color="#8e44ad"
        onGrab={grab}
        heldApi={held}
      />
      <Prop position={[0, 1, 0]} color="#16a085" onGrab={grab} heldApi={held} />
      <Prop
        position={[2.5, 1, 0]}
        color="#d35400"
        onGrab={grab}
        heldApi={held}
      />

      <Bystander position={[1.2, 0.5, -3]} />
      <Bystander position={[-1.2, 0.5, -3.8]} />

      <Hud position={[0, 6, 0]}>
        {held ? "carrying — [ and ] resize, let go to throw" : "drag a cube"}
      </Hud>
    </>
  );
};
