import { Euler, Quaternion } from "three";
import { useBox } from "./Jolt/useBox";
import { useCylinder } from "./Jolt/useCylinder";
import { useSphere } from "./Jolt/useSphere";
import { useCapsule } from "./Jolt/useCapsule";
import { useTaperedCapsule } from "./Jolt/useTaperedCapsule";
import { useTrimesh } from "./Jolt/useTrimesh";
import { useGLTF } from "@react-three/drei";
import { Geometry } from "three-stdlib";
import { useConvex } from "./Jolt/useConvex";

const Scene = () => {
  const suzanne = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/suzanne-high-poly/model.gltf"
  );

  const suzanneMesh = suzanne.nodes.Suzanne as THREE.Mesh;

  suzanneMesh.geometry.rotateY(-Math.PI / 4);

  const pos = suzanneMesh.geometry.getAttribute("position");
  const idx = suzanneMesh.geometry.index?.array;

  const convexGeometry = new Geometry().fromBufferGeometry(
    suzanneMesh.geometry
  );

  convexGeometry.computeVertexNormals();
  convexGeometry.mergeVertices();

  const verts = convexGeometry.vertices.map((v) => [v.x, v.y, v.z]);

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
      restitution: 1,
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
      friction: 0,
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
      friction: 0,
      restitution: 0.8,
    },
  });

  const [trimeshRef, trimeshApi] = useTrimesh({
    mesh: {
      position: pos,
      index: idx!,
    },
    position: [3, -1, 1],
    debug: true,
    material: {
      friction: 0,
    },
  });

  const [convexRef] = useConvex({
    vertices: verts,
    position: [0, 8, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0,
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
      <mesh ref={trimeshRef} geometry={trimeshApi.geometry}>
        <meshNormalMaterial />
      </mesh>
      <mesh ref={convexRef} geometry={suzanneMesh.geometry}>
        <meshNormalMaterial />
      </mesh>
    </>
  );
};

export default Scene;
