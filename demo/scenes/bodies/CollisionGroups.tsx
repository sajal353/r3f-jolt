import { useState } from "react";
import { Controls, Floor, Hud, Tag } from "../../shared/Stage";
import { useSphere } from "@/Jolt/useSphere";
import { useBox } from "@/Jolt/useBox";
import { usePointConstraint } from "@/Jolt/usePointConstraint";
import { useGroupFilterTable } from "@/Jolt/useGroupFilterTable";
import type { GroupFilterTableApi } from "@/Jolt/useGroupFilterTable";
import type { ConstraintBody } from "@/Jolt/internal/useConstraint";
import type { Vec3Tuple } from "@/Jolt/types";

const LINKS = 8;
const RADIUS = 0.42;
/** Closer than a diameter, so every link starts overlapping its neighbours. */
const SPACING = 0.5;
const TOP = 8;

type Link = ConstraintBody | undefined;

const jointAt = (x: number, index: number): Vec3Tuple => [
  x,
  TOP - index * SPACING,
  0,
];

const ChainLink = ({
  x,
  index,
  above,
  filter,
  color,
}: {
  x: number;
  index: number;
  above: Link;
  filter?: GroupFilterTableApi;
  color: string;
}) => {
  const [ref, link] = useSphere({
    position: [x, TOP - (index + 0.5) * SPACING, 0],
    radius: RADIUS,
    motionType: "dynamic",
    mass: 1,
    material: { friction: 0.3, restitution: 0 },
    collisionGroup: filter && {
      filter: filter.filter,
      groupID: 0,
      subGroupID: index,
    },
  });

  usePointConstraint(above, link, { point: jointAt(x, index) });

  return (
    <>
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[RADIUS, 20, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {index + 1 < LINKS && (
        <ChainLink
          x={x}
          index={index + 1}
          above={link}
          filter={filter}
          color={color}
        />
      )}
    </>
  );
};

const Chain = ({
  x,
  filter,
  color,
}: {
  x: number;
  filter?: GroupFilterTableApi;
  color: string;
}) => {
  const [ref, anchor] = useBox({
    position: [x, TOP + 0.2, 0],
    size: [1.4, 0.4, 1.4],
    motionType: "static",
  });

  return (
    <>
      <mesh ref={ref} receiveShadow>
        <boxGeometry args={[1.4, 0.4, 1.4]} />
        <meshStandardMaterial color="#444" />
      </mesh>

      <ChainLink x={x} index={0} above={anchor} filter={filter} color={color} />
    </>
  );
};

// A body reads its filter at creation, so the chain waits for the table.
export const CollisionGroups = () => {
  const [generation, setGeneration] = useState(0);

  const table = useGroupFilterTable(LINKS, (built) => {
    for (let index = 0; index < LINKS - 1; index += 1) {
      built.disableCollision(index, index + 1);
    }
  });

  return (
    <>
      <Floor size={40} />

      <Chain key={`plain-${generation}`} x={-3} color="#c0392b" />
      <Tag position={[-3, 9.2, 0]}>no filter</Tag>

      {table && (
        <Chain
          key={`filtered-${generation}`}
          x={3}
          filter={table}
          color="#27ae60"
        />
      )}
      <Tag position={[3, 9.2, 0]}>filtered</Tag>

      <Controls position={[0, 10.4, 0]}>
        <button onClick={() => setGeneration((n) => n + 1)}>rebuild</button>
      </Controls>

      <Hud position={[0, 11, 0]}>
        Overlapping links, jointed. The left chain hangs longer because every
        link shoves its neighbours apart.
      </Hud>
    </>
  );
};
