import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Color,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type Jolt from "jolt-physics";
import { Floor, Hud, Wall } from "../../shared/Stage";
import { useBox } from "@/Jolt/useBox";
import { useJolt } from "@/Jolt/useJolt";
import { shapeToGeometry } from "@/Jolt/internal/shapeToGeometry";
import type { JoltModule, QuatTuple } from "@/Jolt/types";

const PER_KIND = 150;
const ARENA = 30;
const DROP_HEIGHT = 26;
const FLOOR_OUT = -6;
const UPRIGHT: QuatTuple = [0, 0, 0, 1];

/**
 * `Get()` hands back a shape the result still owns, so the reference has to be
 * taken *before* the result is cleared — clearing first drops the only one and
 * frees the shape out from under us. This is what the library's `finishShape`
 * does internally; a hook would have handled it.
 */
const own = (result: Jolt.ShapeResult): Jolt.Shape => {
  const shape = result.Get();
  shape.AddRef();
  result.Clear();
  return shape;
};

/**
 * One shape per kind, shared by all 150 bodies of that kind. Jolt shapes are
 * immutable and refcounted, which is what makes that safe — and it is the same
 * saving on the physics side that instancing is on the render side.
 *
 * A shape from `new` starts at refcount zero and one from a settings `Create()`
 * is owned by its result, so both paths end at "we hold exactly one reference",
 * released when the swarm unmounts.
 */
const buildShapes = (
  jolt: JoltModule,
): { name: string; shape: Jolt.Shape }[] => {
  const half = new jolt.Vec3(0.3, 0.3, 0.3);
  const box: Jolt.Shape = new jolt.BoxShape(half, 0.03, undefined);
  jolt.destroy(half);

  const sphere: Jolt.Shape = new jolt.SphereShape(0.35, undefined);
  const capsule: Jolt.Shape = new jolt.CapsuleShape(0.3, 0.22, undefined);
  const cylinder: Jolt.Shape = new jolt.CylinderShape(
    0.3,
    0.3,
    0.03,
    undefined,
  );

  for (const shape of [box, sphere, capsule, cylinder]) shape.AddRef();

  const coneSettings = new jolt.TaperedCapsuleShapeSettings(
    0.3,
    0.1,
    0.4,
    undefined,
  );
  const coneResult = coneSettings.Create();
  jolt.destroy(coneSettings);
  const cone = own(coneResult);

  const hullSettings = new jolt.ConvexHullShapeSettings();
  const point = new jolt.Vec3();

  for (const [x, y, z] of [
    [0, 0.5, 0],
    [-0.4, 0, -0.4],
    [0.4, 0, -0.4],
    [0.4, 0, 0.4],
    [-0.4, 0, 0.4],
    [0, -0.5, 0],
  ]) {
    point.Set(x, y, z);
    hullSettings.mPoints.push_back(point);
  }

  jolt.destroy(point);
  const hullResult = hullSettings.Create();
  jolt.destroy(hullSettings);
  const hull = own(hullResult);

  const compoundSettings = new jolt.StaticCompoundShapeSettings();
  const at = new jolt.Vec3(0, 0, 0);
  const facing = new jolt.Quat(0, 0, 0, 1);
  const bar = new jolt.Vec3(0.45, 0.12, 0.12);

  compoundSettings.AddShape(
    at,
    facing,
    new jolt.BoxShapeSettings(bar, 0.03, undefined),
    0,
  );
  at.Set(0, 0.35, 0);
  compoundSettings.AddShape(
    at,
    facing,
    new jolt.SphereShapeSettings(0.2, undefined),
    0,
  );

  jolt.destroy(bar);
  jolt.destroy(at);
  jolt.destroy(facing);

  const compoundResult = compoundSettings.Create();

  // AddShape took a reference to each child, so this releases them too.
  jolt.destroy(compoundSettings);
  const compound = own(compoundResult);

  return [
    { name: "box", shape: box },
    { name: "sphere", shape: sphere },
    { name: "capsule", shape: capsule },
    { name: "cylinder", shape: cylinder },
    { name: "tapered capsule", shape: cone },
    { name: "convex hull", shape: hull },
    { name: "compound", shape: compound },
  ];
};

const COLORS = [
  "#8e44ad",
  "#2980b9",
  "#16a085",
  "#27ae60",
  "#d35400",
  "#c0392b",
  "#f39c12",
];

interface SwarmState {
  bodies: Jolt.Body[];
  ids: Jolt.BodyID[];
  geometries: BufferGeometry[];
  /** Reused by every body put back on top; a temporary a frame would not be. */
  target: Jolt.RVec3;
  upright: Jolt.Quat;
}

const scatter = () => (Math.random() - 0.5) * (ARENA - 6);

/**
 * 1050 bodies in seven draw calls. Nothing here uses a body hook: a hook builds
 * one React component, one mesh and one `useFrame` subscriber per body, which is
 * the right trade up to a few hundred and the wrong one past that. At this count
 * the bodies are created straight through `useJolt()` and their transforms are
 * written into an `InstancedMesh` each frame.
 */
const Swarm = () => {
  const { Jolt: jolt, bodyInterface, layers, state } = useJolt();

  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const swarm = useRef<SwarmState | null>(null);

  useEffect(() => {
    const kinds = buildShapes(jolt);

    const bodies: Jolt.Body[] = [];
    const ids: Jolt.BodyID[] = [];
    const geometries: BufferGeometry[] = [];

    const position = new jolt.RVec3();
    const rotation = new jolt.Quat(0, 0, 0, 1);
    const target = new jolt.RVec3();
    const upright = new jolt.Quat(0, 0, 0, 1);
    const color = new Color();

    kinds.forEach(({ shape }, kind) => {
      const geometry = shapeToGeometry(jolt, shape);
      geometries.push(geometry);

      const mesh = meshes.current[kind];
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      }

      // One settings object per kind, rewound between bodies. Building one per
      // body would be 150 allocations to describe 150 near-identical bodies.
      const settings = new jolt.BodyCreationSettings(
        shape,
        position,
        rotation,
        jolt.EMotionType_Dynamic,
        layers.LAYER_MOVING,
      );
      settings.mRestitution = 0.2;
      settings.mFriction = 0.4;

      for (let index = 0; index < PER_KIND; index += 1) {
        position.Set(scatter(), DROP_HEIGHT * Math.random(), scatter());
        settings.mPosition = position;

        const body = bodyInterface.CreateBody(settings);
        bodyInterface.AddBody(body.GetID(), jolt.EActivation_Activate);

        bodies.push(body);
        ids.push(body.GetID());

        if (mesh) {
          color.set(COLORS[kind]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.25);
          mesh.setColorAt(index, color);
        }
      }

      if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;

      jolt.destroy(settings);
    });

    jolt.destroy(position);
    jolt.destroy(rotation);

    swarm.current = { bodies, ids, geometries, target, upright };

    return () => {
      swarm.current = null;

      if (!state.destroyed) {
        for (const id of ids) {
          bodyInterface.RemoveBody(id);
          bodyInterface.DestroyBody(id);
        }

        for (const { shape } of kinds) shape.Release();

        jolt.destroy(target);
        jolt.destroy(upright);
      }

      for (const geometry of geometries) geometry.dispose();
    };
  }, [jolt, bodyInterface, layers, state]);

  const scratch = useRef({
    matrix: new Matrix4(),
    position: new Vector3(),
    rotation: new Quaternion(),
    scale: new Vector3(1, 1, 1),
  });

  useFrame(() => {
    const current = swarm.current;
    if (!current || state.disposed) return;

    const { matrix, position, rotation, scale } = scratch.current;

    for (let kind = 0; kind < meshes.current.length; kind += 1) {
      const mesh = meshes.current[kind];
      if (!mesh) continue;

      let moved = false;

      for (let index = 0; index < PER_KIND; index += 1) {
        const slot = kind * PER_KIND + index;
        const body = current.bodies[slot];

        // Jolt deactivates a body that has come to rest, and its matrix is
        // already correct from the last frame it moved. Skipping those is the
        // difference between paying for every body every frame and paying only
        // for the ones still doing something — reading a transform out of WASM
        // is half a dozen boundary crossings, and there are a thousand bodies.
        if (!body.IsActive()) continue;

        let at = body.GetPosition();

        // Anything that bounces out of the pit is put back on top rather than
        // deleted, so the body count — and the cost — stays flat for as long as
        // the scene runs.
        if (at.GetY() < FLOOR_OUT) {
          current.target.Set(scatter(), DROP_HEIGHT, scatter());
          bodyInterface.SetPositionAndRotation(
            current.ids[slot],
            current.target,
            current.upright,
            jolt.EActivation_Activate,
          );
          at = body.GetPosition();
        }

        const facing = body.GetRotation();

        position.set(at.GetX(), at.GetY(), at.GetZ());
        rotation.set(
          facing.GetX(),
          facing.GetY(),
          facing.GetZ(),
          facing.GetW(),
        );

        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        moved = true;
      }

      // Re-uploading the buffer for a kind that has entirely settled would undo
      // the saving above.
      if (moved) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {COLORS.map((color, index) => (
        <instancedMesh
          key={color}
          ref={(node) => {
            meshes.current[index] = node;
          }}
          args={[undefined, undefined, PER_KIND]}
          // Every instance moves, so the bounds computed at creation are a lie.
          frustumCulled={false}
          // No `castShadow`: a shadow map draws every caster a second time, and
          // a thousand of them buys very little in a pit lit from above.
          receiveShadow
        >
          <meshStandardMaterial />
        </instancedMesh>
      ))}
    </>
  );
};

/** Kinematic, and the only thing in the scene that does use a hook. */
const Paddle = () => {
  const [ref, api] = useBox({
    position: [0, 1.2, 0],
    size: [ARENA - 6, 2.4, 1.2],
    motionType: "kinematic",
    material: { friction: 0.9 },
  });

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!api) return;

    elapsed.current += delta;
    api.moveKinematic([0, 1.2, Math.sin(elapsed.current * 0.5) * 9], UPRIGHT);
  });

  return (
    <mesh ref={ref} position={[0, 1.2, 0]} castShadow>
      <boxGeometry args={[ARENA - 6, 2.4, 1.2]} />
      <meshStandardMaterial color="#2980b9" />
    </mesh>
  );
};

const Readout = () => {
  const { Jolt: jolt, physicsSystem, state } = useJolt();
  const [line, setLine] = useState("starting up");

  const elapsed = useRef(0);
  const frames = useRef(0);

  useFrame((_, delta) => {
    if (state.disposed) return;

    elapsed.current += delta;
    frames.current += 1;

    if (elapsed.current < 0.4) return;

    setLine(
      `${Math.round(frames.current / elapsed.current)} fps · ` +
        `${physicsSystem.GetNumBodies()} bodies, ` +
        `${physicsSystem.GetNumActiveBodies(jolt.EBodyType_RigidBody)} awake · ` +
        `${COLORS.length} draw calls`,
    );

    elapsed.current = 0;
    frames.current = 0;
  });

  return <Hud position={[0, 8, 0]}>{line}</Hud>;
};

export const Instancing = () => (
  <>
    <Floor size={ARENA} friction={0.6} />
    <Wall position={[0, 3, -ARENA / 2]} size={[ARENA, 6, 1]} />
    <Wall position={[0, 3, ARENA / 2]} size={[ARENA, 6, 1]} />
    <Wall position={[-ARENA / 2, 3, 0]} size={[1, 6, ARENA]} />
    <Wall position={[ARENA / 2, 3, 0]} size={[1, 6, ARENA]} />

    <Paddle />
    <Swarm />
    <Readout />
  </>
);
