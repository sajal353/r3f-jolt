import { useBox } from "./Jolt/useBox";

const Scene = () => {
  const [floorRef] = useBox({
    position: [0, 0, 0],
    rotation: [0, 0, -0.1, 1],
    geometry: [10, 0.01, 10],
    debug: true,
    motionType: "static",
    material: {
      friction: 0,
    },
  });

  const [boxRef] = useBox({
    position: [0, 3, 0],
    geometry: [1, 1, 1],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0,
      restitution: 0,
    },
  });

  return (
    <>
      <mesh ref={floorRef}>
        <boxGeometry args={[10, 0.01, 10]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={boxRef}>
        <boxGeometry args={[1, 1, 1]} />
        <meshNormalMaterial />
      </mesh>
    </>
  );
};

export default Scene;
