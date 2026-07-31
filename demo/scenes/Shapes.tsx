import { Suspense, useMemo } from "react";
import { Euler, Mesh, Quaternion } from "three";
import { useGLTF } from "@react-three/drei";
import { mergeVertices } from "three-stdlib";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useCapsule } from "@/Jolt/useCapsule";
import { useCylinder } from "@/Jolt/useCylinder";
import { useTaperedCapsule } from "@/Jolt/useTaperedCapsule";
import { useConvex } from "@/Jolt/useConvex";
import { useCompound } from "@/Jolt/useCompound";
import { useTrimesh } from "@/Jolt/useTrimesh";

const SUZANNE = "/models/suzanne/Suzanne.gltf";

const quaternion = (x: number, y: number, z: number) =>
  new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ")).toArray() as [
    number,
    number,
    number,
    number,
  ];

const Primitives = () => {
  const [floorRef] = useBox({
    position: [0, -0.5, 0],
    size: [60, 1, 60],
    motionType: "static",
    material: { friction: 0.8 },
  });

  const [boxRef] = useBox({
    position: [-3, 6, 0],
    size: [1, 1, 1],
    motionType: "dynamic",
    mass: 20,
    material: { friction: 0.5, restitution: 0.4 },
  });

  const [sphereRef] = useSphere({
    radius: 0.5,
    position: [-1.5, 7, 0],
    motionType: "dynamic",
    mass: 20,
    material: { friction: 1, restitution: 0.6 },
  });

  const [cylinderRef] = useCylinder({
    height: 2,
    radius: 0.5,
    position: [0, 8, 0],
    rotation: quaternion(Math.PI / 2, 0, -Math.PI / 4),
    motionType: "dynamic",
    mass: 20,
    material: { friction: 0.5, restitution: 0.3 },
  });

  const [capsuleRef] = useCapsule({
    height: 2,
    radius: 0.5,
    position: [1.5, 9, 0],
    motionType: "dynamic",
    mass: 20,
  });

  const [taperedRef, taperedApi] = useTaperedCapsule({
    topRadius: 0.25,
    bottomRadius: 0.5,
    height: 1.5,
    position: [3, 10, 0],
    motionType: "dynamic",
    mass: 20,
  });

  const [compoundRef, compoundApi] = useCompound({
    shapes: [
      { type: "box", position: [0, 0, 0], size: [0.6, 0.6, 0.6] },
      { type: "sphere", position: [0, 0.6, 0], radius: 0.35 },
      {
        type: "cylinder",
        position: [0, 1.2, 0],
        rotation: quaternion(Math.PI / 2, 0, 0),
        height: 1.2,
        radius: 0.2,
      },
    ],
    position: [-5, 6, 0],
    motionType: "dynamic",
    mass: 30,
  });

  return (
    <>
      <mesh ref={floorRef} receiveShadow>
        <boxGeometry args={[60, 1, 60]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <mesh ref={boxRef} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={sphereRef} castShadow>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={cylinderRef} castShadow>
        <cylinderGeometry args={[0.5, 0.5, 2, 32]} />
        <meshNormalMaterial />
      </mesh>
      <mesh ref={capsuleRef} castShadow>
        <capsuleGeometry args={[0.5, 2]} />
        <meshNormalMaterial />
      </mesh>
      {taperedApi && (
        <mesh ref={taperedRef} geometry={taperedApi.geometry} castShadow>
          <meshNormalMaterial />
        </mesh>
      )}
      {compoundApi && (
        <mesh ref={compoundRef} geometry={compoundApi.geometry} castShadow>
          <meshNormalMaterial />
        </mesh>
      )}
    </>
  );
};

const Suzanne = () => {
  const gltf = useGLTF(SUZANNE);

  const { renderGeometry, material, hullVertices } = useMemo(() => {
    const mesh = gltf.nodes.Suzanne as Mesh;
    // mergeVertices welds the duplicated seam vertices the glTF carries for
    // UVs; the hull only needs distinct positions.
    const merged = mergeVertices(mesh.geometry);
    const position = merged.getAttribute("position");

    const vertices: number[][] = [];
    for (let i = 0; i < position.count; i += 1) {
      vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
    }

    return {
      renderGeometry: mesh.geometry,
      material: mesh.material,
      hullVertices: vertices,
    };
  }, [gltf]);

  const [convexRef, convexApi] = useConvex({
    vertices: hullVertices,
    position: [2, 12, 2],
    motionType: "dynamic",
    mass: 40,
  });

  const [trimeshRef, trimeshApi] = useTrimesh({
    mesh: renderGeometry,
    position: [7, 0, 3],
  });

  return (
    <>
      {convexApi && (
        <mesh
          ref={convexRef}
          geometry={renderGeometry}
          material={material}
          castShadow
        />
      )}
      {trimeshApi && (
        <mesh ref={trimeshRef} geometry={trimeshApi.geometry} receiveShadow>
          <meshStandardMaterial color="#3c6e8f" flatShading />
        </mesh>
      )}
    </>
  );
};

export const Shapes = () => (
  <>
    <Primitives />
    <Suspense fallback={null}>
      <Suzanne />
    </Suspense>
  </>
);

useGLTF.preload(SUZANNE);
