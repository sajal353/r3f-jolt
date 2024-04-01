import { Euler, Quaternion, Vector3 } from "three";
import { useBox } from "./Jolt/useBox";
import { useCylinder } from "./Jolt/useCylinder";
import { useSphere } from "./Jolt/useSphere";
import { useCapsule } from "./Jolt/useCapsule";
import { useTaperedCapsule } from "./Jolt/useTaperedCapsule";
import { useTrimesh } from "./Jolt/useTrimesh";
import { useGLTF } from "@react-three/drei";
import { Geometry } from "three-stdlib";
import { useConvex } from "./Jolt/useConvex";
import { useCompound } from "./Jolt/useCompound";
import { useCharacter } from "./Jolt/useCharacter";
import { useFrame } from "@react-three/fiber";

const Scene = () => {
  const suzanne = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/suzanne-high-poly/model.gltf"
  );

  const suzanneMesh = suzanne.nodes.Suzanne as THREE.Mesh;

  const pos = suzanneMesh.geometry.getAttribute("position");
  const idx = suzanneMesh.geometry.index?.array;

  const convexGeometry = new Geometry().fromBufferGeometry(
    suzanneMesh.geometry
  );

  convexGeometry.computeVertexNormals();
  convexGeometry.mergeVertices();

  const verts = convexGeometry.vertices.map((v) => [v.x, v.y, v.z]);

  // const { physicsSystem } = useJolt();

  const [floorRef] = useBox({
    position: [0, 0, 0],
    // rotation: [0, 0, -0.1, 1],
    size: [100, 0.01, 100],
    debug: true,
    motionType: "static",
  });

  const [boxRef] = useBox({
    position: [0, 3, 0],
    size: [1, 1, 1],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0.5,
      restitution: 0.5,
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
      friction: 0.5,
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
      friction: 0.5,
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
      friction: 0.5,
      restitution: 0.8,
    },
  });

  const [trimeshRef, trimeshApi] = useTrimesh({
    mesh: {
      position: pos,
      index: idx!,
    },
    position: [3, 0, 1],
    debug: true,
    material: {
      friction: 0.5,
    },
  });

  const [convexRef, convexApi] = useConvex({
    vertices: verts,
    position: [0, 8, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0.5,
      restitution: 0.5,
    },
  });

  const [compoundRef, compoundApi] = useCompound({
    shapes: [
      {
        type: "box",
        position: [0, 0, 0],
        size: [0.5, 0.5, 0.5],
      },
      {
        type: "capsule",
        position: [0, 0.5, 0],
        height: 1,
        radius: 0.25,
      },
      {
        type: "cylinder",
        position: [0, 1, 0],
        rotation: new Quaternion()
          .setFromEuler(new Euler(Math.PI / 2, 0, 0))
          .toArray() as [number, number, number, number],
        height: 2,
        radius: 0.25,
      },
      {
        type: "sphere",
        position: [0, 1.5, 0],
        radius: 0.5,
      },
      {
        type: "taperedCapsule",
        position: [0, 2, 0],
        topRadius: 0.25,
        bottomRadius: 0.125,
        height: 0.5,
      },
      {
        type: "convex",
        position: [0, 2, 0],
        vertices: verts,
      },
    ],
    position: [-3, 2, 0],
    debug: true,
    motionType: "dynamic",
    material: {
      friction: 0.5,
      restitution: 0.5,
    },
  });

  const [characterApi] = useCharacter({
    options: {
      height: {
        standing: 1,
        crouching: 0.5,
      },
      radius: {
        standing: 0.4,
        crouching: 0.4,
      },
      moveDuringJump: true,
      moveSpeed: 5,
      crouchMoveSpeedRatio: 0.5,
      jumpSpeed: 10,
      enableInertia: true,
      enableStairStep: true,
      enableStickToFloor: true,
    },
    position: [0, 5, 0],
    debug: true,
    mass: 1000,
  });

  useFrame(({ clock }, delta) => {
    const et = clock.getElapsedTime();

    characterApi &&
      characterApi.update(
        new Vector3(Math.sin(et), 0, Math.cos(et)),
        false,
        false,
        delta
      );
  });

  return (
    <>
      <mesh ref={floorRef}>
        <boxGeometry args={[100, 0.01, 100]} />
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
      {taperedCapsuleApi && (
        <mesh ref={taperedCapsuleRef} geometry={taperedCapsuleApi.geometry}>
          <meshNormalMaterial />
        </mesh>
      )}
      {trimeshApi && (
        <mesh ref={trimeshRef} geometry={trimeshApi.geometry}>
          <meshNormalMaterial />
        </mesh>
      )}
      {convexApi && (
        <mesh ref={convexRef} geometry={suzanneMesh.geometry}>
          <meshNormalMaterial />
        </mesh>
      )}
      {compoundApi && (
        <mesh ref={compoundRef} geometry={compoundApi.geometry}>
          <meshNormalMaterial />
        </mesh>
      )}
    </>
  );
};

export default Scene;
