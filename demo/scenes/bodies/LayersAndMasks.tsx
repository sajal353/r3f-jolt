import { Floor, Tag } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useSphere } from "@/Jolt/useSphere";
import { useJolt } from "@/Jolt/useJolt";

// Three groups beyond the built-in static/moving split. A body collides with
// another only when each one's mask contains the other's group — the test runs
// both ways, so it takes two agreeing masks to make a collision.
const GROUP_WORLD = 1 << 0;
const GROUP_RED = 1 << 2;
const GROUP_BLUE = 1 << 3;

const Ball = ({
  x,
  group,
  mask,
  color,
}: {
  x: number;
  group: number;
  mask: number;
  color: string;
}) => {
  const { objectLayer } = useJolt();

  const [ref] = useSphere({
    radius: 0.5,
    position: [x, 7, 0],
    motionType: "dynamic",
    mass: 2,
    layer: objectLayer(group, mask),
    material: { restitution: 0.3 },
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.5, 24, 24]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
};

const Shelf = ({
  x,
  group,
  mask,
  color,
}: {
  x: number;
  group: number;
  mask: number;
  color: string;
}) => {
  const { objectLayer } = useJolt();

  const [ref] = useBox({
    position: [x, 3, 0],
    size: [2.4, 0.3, 2.4],
    motionType: "static",
    layer: objectLayer(group, mask),
  });

  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[2.4, 0.3, 2.4]} />
      <meshStandardMaterial color={color} transparent opacity={0.85} />
    </mesh>
  );
};

export const LayersAndMasks = () => (
  <>
    <Floor size={40} />

    {/* Red shelf accepts red only; blue shelf accepts blue only. Each ball
        lands on its own shelf and falls straight through the other. */}
    <Shelf x={-3} group={GROUP_RED} mask={GROUP_RED} color="#c0392b" />
    <Shelf x={3} group={GROUP_BLUE} mask={GROUP_BLUE} color="#2471a3" />

    <Ball
      x={-3}
      group={GROUP_RED}
      mask={GROUP_RED | GROUP_WORLD}
      color="#e74c3c"
    />
    <Ball
      x={3}
      group={GROUP_BLUE}
      mask={GROUP_BLUE | GROUP_WORLD}
      color="#3498db"
    />

    {/* Dropped between them with a mask that matches neither shelf. */}
    <Ball x={0} group={GROUP_RED} mask={GROUP_WORLD} color="#95a5a6" />

    <Tag position={[-3, 5, 0]}>red shelf</Tag>
    <Tag position={[3, 5, 0]}>blue shelf</Tag>
    <Tag position={[0, 9, 0]}>
      grey ball masks only the world — it ignores both shelves
    </Tag>
    <Tag position={[0, 10.2, 0]}>
      16 bits of group and 16 of mask, packed into one 32-bit layer
    </Tag>
  </>
);
