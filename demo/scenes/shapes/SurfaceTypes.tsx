import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from "three";
import { Hud } from "../../shared/Stage";
import { useTrimesh } from "@/Jolt/useTrimesh";
import { useClosestHitRaycaster } from "@/Jolt/useClosestHitRaycaster";
import { useBeam } from "../../shared/helpers";

const CELLS = 12;
const EXTENT = 12;
const CELL = EXTENT / CELLS;

/** Index 0 is unused: an untagged triangle reads back as 0, and that has to be
 *  distinguishable from a real surface. */
const SURFACES = [
  { name: "—", color: [0.25, 0.25, 0.25] },
  { name: "grass", color: [0.29, 0.53, 0.25] },
  { name: "stone", color: [0.45, 0.45, 0.48] },
  { name: "sand", color: [0.83, 0.72, 0.44] },
  { name: "metal", color: [0.35, 0.45, 0.62] },
];

const surfaceOf = (cx: number, cz: number) => {
  const u = cx / CELLS - 0.5;
  const v = cz / CELLS - 0.5;
  const ring = Math.hypot(u, v);

  if (ring < 0.18) return 4;
  if (ring < 0.32) return 2;
  return Math.sin(u * 7) * Math.cos(v * 5) > 0 ? 1 : 3;
};

/**
 * One geometry for both the collider and the mesh, so the colour a viewer sees
 * and the tag the ray reads cannot disagree. Wound counter-clockwise from
 * above: Jolt culls a mesh's back faces, and the other way round would let
 * every ray straight through.
 */
const buildSurface = () => {
  const positions = new Float32Array(CELLS * CELLS * 6 * 3);
  const colors = new Float32Array(CELLS * CELLS * 6 * 3);
  const tags: number[] = [];

  let vertex = 0;

  const push = (x: number, z: number, tag: number) => {
    positions[vertex * 3] = x;
    positions[vertex * 3 + 1] = 0;
    positions[vertex * 3 + 2] = z;

    const [r, g, b] = SURFACES[tag].color;
    colors[vertex * 3] = r;
    colors[vertex * 3 + 1] = g;
    colors[vertex * 3 + 2] = b;

    vertex += 1;
  };

  for (let cz = 0; cz < CELLS; cz += 1) {
    for (let cx = 0; cx < CELLS; cx += 1) {
      const tag = surfaceOf(cx, cz);
      const x0 = cx * CELL - EXTENT / 2;
      const z0 = cz * CELL - EXTENT / 2;
      const x1 = x0 + CELL;
      const z1 = z0 + CELL;

      push(x0, z0, tag);
      push(x0, z1, tag);
      push(x1, z1, tag);

      push(x0, z0, tag);
      push(x1, z1, tag);
      push(x1, z0, tag);

      tags.push(tag, tag);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return { geometry, tags };
};

export const SurfaceTypes = () => {
  const { geometry, tags } = useMemo(() => buildSurface(), []);

  const [ref, surface] = useTrimesh({
    mesh: geometry,
    position: [0, 0, 0],
    triangleUserData: tags,
  });

  const [raycaster] = useClosestHitRaycaster();
  const beam = useBeam("#f1c40f");
  const marker = useRef<Mesh>(null);
  const [readout, setReadout] = useState("no hit");

  const origin = useRef(new Vector3());
  const direction = useRef(new Vector3(0, -8, 0));
  const lastUpdate = useRef(0);

  useFrame(({ clock }) => {
    if (!raycaster) return;

    const time = clock.getElapsedTime();
    // A Lissajous sweep, so the probe crosses every patch rather than tracing
    // one band forever.
    origin.current.set(
      Math.sin(time * 0.53) * 5,
      4,
      Math.cos(time * 0.31) * 5,
    );

    const hit = raycaster.cast(origin.current, direction.current);

    beam.set(
      origin.current,
      hit.hit
        ? hit.point
        : origin.current.clone().add(direction.current),
    );

    if (marker.current) {
      marker.current.visible = hit.hit;
      if (hit.hit) marker.current.position.copy(hit.point);
    }

    if (time - lastUpdate.current > 0.1) {
      lastUpdate.current = time;

      // `subShapeID` names the triangle; the tag is what turns that into
      // something a game can act on — a footstep sound, tyre grip, a decal.
      const tag = hit.hit ? (surface?.getTriangleUserData(hit.subShapeID) ?? 0) : 0;

      setReadout(hit.hit ? `surface: ${SURFACES[tag].name}` : "no hit");
    }
  });

  return (
    <>
      <mesh ref={ref} geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors flatShading />
      </mesh>

      <primitive object={beam.object} />

      <mesh ref={marker} visible={false}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial color="#f1c40f" />
      </mesh>

      <Hud position={[0, 6, 0]}>{readout}</Hud>
    </>
  );
};
