import { useEffect } from "react";
import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useJolt } from "@/Jolt/useJolt";

/** Per-hook `debug`: one collider, coloured by shape kind. */
const Inspected = () => {
  const [ref] = useSphere({
    radius: 0.8,
    position: [-4, 5, 0],
    motionType: "dynamic",
    mass: 3,
    debug: true,
  });

  return (
    <mesh ref={ref} castShadow>
      {/* Deliberately smaller than the collider, so the wireframe is visibly
          not the same thing as the mesh. */}
      <sphereGeometry args={[0.5, 20, 20]} />
      <meshStandardMaterial color="#8e44ad" />
    </mesh>
  );
};

const Ordinary = ({ x }: { x: number }) => {
  const [ref] = useBox({
    position: [x, 5, 0],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 2,
  });

  return (
    <mesh ref={ref} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#16a085" />
    </mesh>
  );
};

/**
 * Four bodies off one shape, none with a mesh. Nothing draws these until
 * `<PhysicsDebug />` is on — and because the shape is shared, all four
 * wireframes share a single `BufferGeometry`.
 */
const Invisible = () => {
  const api = useJolt();

  useEffect(() => {
    const { Jolt: jolt, bodyInterface, layers } = api;

    const halfExtent = new jolt.Vec3(0.5, 0.5, 0.5);
    const shape = new jolt.BoxShape(halfExtent, 0.05, undefined);
    jolt.destroy(halfExtent);
    shape.AddRef();

    const rotation = new jolt.Quat(0, 0, 0, 1);
    const ids = [3, 4.4, 5.8, 7.2].map((x) => {
      const position = new jolt.RVec3(x, 0.5, 0);
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
      bodyInterface.AddBody(body.GetID(), jolt.EActivation_DontActivate);
      return body.GetID();
    });

    jolt.destroy(rotation);
    shape.Release();

    return () => {
      if (api.state.destroyed) return;
      for (const id of ids) {
        bodyInterface.RemoveBody(id);
        bodyInterface.DestroyBody(id);
      }
    };
  }, [api]);

  return null;
};

export const DebugRendering = () => (
  <>
    <Floor size={40} />

    <Inspected />
    <Ordinary x={-1.5} />
    <Ordinary x={0.5} />
    <Invisible />

    <Tag position={[-4, 7, 0]}>per-hook debug · always on for this one</Tag>
    <Tag position={[5, 2.4, 0]}>
      four bodies here, no meshes — turn on PhysicsDebug
    </Tag>
    <Tag position={[0, 9, 0]}>
      PhysicsDebug colours by motion type · per-hook debug colours by shape kind
    </Tag>
  </>
);
