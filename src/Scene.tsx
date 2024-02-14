import { Euler, Quaternion } from "three";
import { useBox } from "./Jolt/useBox";
import { useCylinder } from "./Jolt/useCylinder";
import { useSphere } from "./Jolt/useSphere";
import { useCapsule } from "./Jolt/useCapsule";
import { useTaperedCapsule } from "./Jolt/useTaperedCapsule";

const Scene = () => {
  const [floorRef] = useBox({
    position: [0, 0, 0],
    rotation: [0, 0, -0.1, 1],
    size: [10, 0.01, 10],
    debug: true,
    motionType: "static",
    material: {
      friction: 0,
    },
  });

  const [boxRef] = useBox({
    position: [0, 3, 0],
    size: [1, 1, 1],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0,
      restitution: 0,
    },
  });

  const [sphereRef] = useSphere({
    radius: 0.5,
    position: [0, 4, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 1,
      restitution: 0.1,
    },
  });

  const [cylinderRef] = useCylinder({
    height: 2,
    radius: 0.5,
    position: [0, 5, 0],
    rotation: new Quaternion()
      .setFromEuler(new Euler(Math.PI / 2, 0, -Math.PI / 4, "XYZ"))
      .toArray() as [number, number, number, number],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0,
      restitution: 0.75,
    },
  });

  const [capsuleRef] = useCapsule({
    height: 2,
    radius: 0.5,
    position: [0, 6, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 1,
      restitution: 0.5,
    },
  });

  const [taperedCapsuleRef, taperedCapsuleApi] = useTaperedCapsule({
    topRadius: 0.25,
    bottomRadius: 0.5,
    height: 3,
    position: [0, 7, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 1,
      restitution: 0.5,
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
      <mesh ref={sphereRef}>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={cylinderRef}>
        <cylinderGeometry args={[0.5, 0.5, 2, 32]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={capsuleRef}>
        <capsuleGeometry args={[0.5, 2]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={taperedCapsuleRef} geometry={taperedCapsuleApi.geometry}>
        <meshNormalMaterial />
      </mesh>
    </>
  );
};

export default Scene;
