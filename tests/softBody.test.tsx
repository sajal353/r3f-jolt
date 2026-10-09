import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  BufferAttribute,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from "three";
import type Jolt from "jolt-physics";
import { useBox } from "@/Jolt/useBox";
import { useFrame } from "@react-three/fiber";
import { useCharacter, type CharacterApi } from "@/Jolt/useCharacter";
import { useSoftBody, type SoftBodyApi, type UseSoftBodyOptions } from "@/Jolt/useSoftBody";
import { useSoftBodyContactListener } from "@/Jolt/useSoftBodyContactListener";
import { useBodyContacts } from "@/Jolt/useBodyContacts";
import { useSensor } from "@/Jolt/useSensor";
import { useAfterPhysicsStep } from "@/Jolt/useAfterPhysicsStep";
import { WaterVolume } from "@/Jolt/WaterVolume";
import { PhysicsDebug } from "@/Jolt/PhysicsDebug";
import { createRaycastContext, createHit } from "@/Jolt/internal/raycast";
import {
  softBodyMotion,
  softBodyVertices,
} from "@/Jolt/internal/softBodyVertices";
import { HAS_CONTACT_BYTE } from "@/Jolt/internal/softContacts";
import type { BodyApi } from "@/Jolt/internal/useBody";
import type { ContactInfo } from "@/Jolt/types";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
  updatePhysics,
} from "./harness";

const held: {
  soft?: SoftBodyApi;
  mesh?: Mesh | null;
  floor?: BodyApi<Jolt.BoxShape>;
  scene?: Scene;
} = {};
const log: string[] = [];
const contacts: ContactInfo[] = [];

const reset = () => {
  held.soft = undefined;
  held.mesh = undefined;
  held.floor = undefined;
  log.length = 0;
  contacts.length = 0;
};

/** A 2 m square in the XZ plane, `segments` quads a side. */
const sheet = (segments = 8) => {
  const geometry = new PlaneGeometry(2, 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
};

const Floor = ({ y = 0, listen = false }: { y?: number; listen?: boolean }) => {
  const [, api] = useBox({
    size: [20, 1, 20],
    position: [0, y - 0.5, 0],
    motionType: "static",
    userData: 7,
  });

  useEffect(() => {
    held.floor = api;
  }, [api]);

  useBodyContacts(api?.body, {
    onEnter: listen ? () => log.push("floor:enter") : undefined,
    onExit: listen ? () => log.push("floor:exit") : undefined,
  });

  return null;
};

const Soft = ({
  geometry,
  listen = false,
  ...options
}: UseSoftBodyOptions & { geometry: BufferGeometry; listen?: boolean }) => {
  const [ref, api] = useSoftBody(geometry, options);

  useEffect(() => {
    held.soft = api;
    held.mesh = ref.current;
  }, [api, ref]);

  useBodyContacts(api?.body, {
    onEnter: listen
      ? (contact) => {
          log.push(`soft:enter:${contact.userData}`);
          contacts.push({ ...contact, normal: contact.normal.clone() });
        }
      : undefined,
    onStay: listen ? () => log.push("soft:stay") : undefined,
    onExit: listen ? () => log.push("soft:exit") : undefined,
  });

  return <mesh ref={ref} geometry={api?.geometry} />;
};

const soft = () => {
  if (!held.soft) throw new Error("soft body was never created");
  return held.soft;
};

/** Every geometry vertex's world position, read through the api. */
const worldVertices = (api: SoftBodyApi) => {
  const count = api.geometry.getAttribute("position").count;
  return Array.from({ length: count }, (_, index) => api.getVertex(index));
};

/** The rendered position of a geometry vertex: the attribute plus the mesh. */
const rendered = (index: number) => {
  const api = soft();
  const position = api.geometry.getAttribute("position") as BufferAttribute;
  return new Vector3()
    .fromBufferAttribute(position, index)
    .add(held.mesh?.position ?? new Vector3());
};

describe("useSoftBody", () => {
  it("keeps pinned vertices exactly in place while the rest falls", async () => {
    reset();
    const geometry = sheet();
    const renderer = await renderPhysics(
      <Soft
        geometry={geometry}
        position={[0, 3, 0]}
        pinned={(point) => point.z < -0.99}
      />,
    );
    await step(renderer, 2);

    const before = worldVertices(soft());
    const source = geometry.getAttribute("position");
    let lowest = Infinity;

    // It swings like a pendulum, so the free edge is tracked over the swing.
    for (let frame = 0; frame < 60; frame += 1) {
      await step(renderer, 1);
      const now = worldVertices(soft());

      for (let index = 0; index < source.count; index += 1) {
        if (source.getZ(index) < -0.99) {
          expect(now[index].distanceTo(before[index])).toBeLessThan(1e-5);
        } else {
          lowest = Math.min(lowest, now[index].y);
        }
      }
    }

    expect(lowest).toBeLessThan(1.2);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("welds a box's split corners into one vertex each", async () => {
    reset();
    const geometry = new BoxGeometry(1, 1, 1);
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Soft geometry={geometry} position={[0, 2, 0]} pressure={500} />
      </>,
    );
    await step(renderer, 120);

    expect(soft().vertexCount).toBe(8);

    const source = geometry.getAttribute("position");
    const corners = new Map<string, Vector3[]>();
    for (let index = 0; index < source.count; index += 1) {
      const key = `${source.getX(index)},${source.getY(index)},${source.getZ(index)}`;
      const list = corners.get(key) ?? [];
      list.push(rendered(index));
      corners.set(key, list);
    }

    expect(corners.size).toBe(8);
    for (const twins of corners.values()) {
      for (const twin of twins) expect(twin.distanceTo(twins[0])).toBe(0);
    }

    const box = soft().geometry.boundingBox;
    expect(box && box.max.y - box.min.y).toBeGreaterThan(0.6);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("holds a ball up with pressure", async () => {
    const height = async (pressure: number) => {
      reset();
      const renderer = await renderPhysics(
        <>
          <Floor />
          <Soft
            geometry={new SphereGeometry(0.5, 12, 8)}
            position={[0, 1, 0]}
            pressure={pressure}
            compliance={1e-4}
          />
        </>,
      );
      await step(renderer, 180);
      const box = soft().geometry.boundingBox;
      await unmount(renderer);
      return box ? box.max.y - box.min.y : 0;
    };

    const slack = await height(0);
    const inflated = await height(1000);
    expect(inflated).toBeGreaterThan(0.8);
    expect(inflated).toBeGreaterThan(slack + 0.2);
    expectNoAsserts();
  });

  it("builds volume constraints from tetrahedra", async () => {
    reset();
    // A cube as five tetrahedra, over BoxGeometry's first corner of each kind.
    const geometry = new BoxGeometry(1, 1, 1);
    const source = geometry.getAttribute("position");
    const corner = (x: number, y: number, z: number) => {
      for (let index = 0; index < source.count; index += 1) {
        if (
          source.getX(index) === x * 0.5 &&
          source.getY(index) === y * 0.5 &&
          source.getZ(index) === z * 0.5
        ) {
          return index;
        }
      }
      throw new Error("corner not found");
    };
    const [a, b, c, d, e, f, g, h] = [
      corner(-1, -1, -1),
      corner(1, -1, -1),
      corner(1, -1, 1),
      corner(-1, -1, 1),
      corner(-1, 1, -1),
      corner(1, 1, -1),
      corner(1, 1, 1),
      corner(-1, 1, 1),
    ];
    const tetrahedra = [
      ...[a, b, d, e],
      ...[b, c, d, g],
      ...[b, e, f, g],
      ...[d, e, g, h],
      ...[b, d, e, g],
    ];

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Soft geometry={geometry} position={[0, 2, 0]} tetrahedra={tetrahedra} />
      </>,
    );
    await step(renderer, 120);

    const jolt = getApi().Jolt;
    const settings = softBodyMotion(jolt, soft().body).GetSettings();
    expect(settings.mVolumeConstraints.size()).toBe(5);

    const box = soft().geometry.boundingBox;
    expect(box && box.max.y - box.min.y).toBeGreaterThan(0.8);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("reads the inverse mass where the layout says it is", async () => {
    reset();
    const renderer = await renderPhysics(
      <Soft geometry={sheet(2)} mass={4.5} pinned={[0]} />,
    );
    await step(renderer, 1);

    const jolt = getApi().Jolt;
    const { body } = soft();
    const layout = softBodyVertices(jolt, body);
    const motion = softBodyMotion(jolt, body);

    for (let index = 0; index < layout.count; index += 1) {
      expect(jolt.HEAPF32[layout.inverseMass + index * layout.stride]).toBe(
        motion.GetVertex(index).mInvMass,
      );
    }
    // Nine vertices, one pinned: 4.5 kg over eight.
    expect(motion.GetVertex(1).mInvMass).toBeCloseTo(8 / 4.5, 5);
    expect(motion.GetVertex(0).mInvMass).toBe(0);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useSoftBody readback", () => {
  it("renders what getVertex reads, into the same arrays, without growing the heap", async () => {
    reset();
    const module = await loadDebugModule();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Soft
          geometry={sheet()}
          position={[0, 2, 0]}
          pinned={(point) => point.x < -0.99}
          allowSleeping={false}
        />
      </>,
      { interpolate: false },
    );
    // Past the first contact: Jolt grows a soft body's colliding-shape list
    // once, the first time it touches something, and keeps it.
    await step(renderer, 120);

    const position = soft().geometry.getAttribute("position");
    const normal = soft().geometry.getAttribute("normal");
    const positions = position.array;
    const normals = normal.array;
    const free = module.JoltInterface.prototype.sGetFreeMemory();

    await step(renderer, 200);

    expect(position.array).toBe(positions);
    expect(normal.array).toBe(normals);
    expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(free);

    for (const index of [0, 17, 40, 80]) {
      expect(rendered(index).distanceTo(soft().getVertex(index))).toBeLessThan(
        1e-5,
      );
    }
    await unmount(renderer);
    expectNoAsserts();
  });

  it("stops uploading once the cloth is asleep", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Soft geometry={sheet(4)} position={[0, 0.3, 0]} />
      </>,
    );

    for (let frame = 0; frame < 900 && !soft().isSleeping(); frame += 1) {
      await step(renderer, 1);
    }
    expect(soft().isSleeping()).toBe(true);

    await step(renderer, 2);
    const position = soft().geometry.getAttribute("position") as BufferAttribute;
    const version = position.version;
    await step(renderer, 30);
    expect(position.version).toBe(version);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("draws between the last two steps", async () => {
    reset();
    const steps: Vector3[] = [];

    const Recorder = () => {
      useAfterPhysicsStep(function recordVertex() {
        if (held.soft) steps.push(held.soft.getVertex(80));
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Soft
          geometry={sheet()}
          position={[0, 3, 0]}
          pinned={(point) => point.x < -0.99}
        />
        <Recorder />
      </>,
      { timeStep: 1 / 60, interpolate: true },
    );
    await step(renderer, 20, 1 / 60);

    // Half a step per frame: every other frame lands midway.
    const checked: number[] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      const before = steps.length;
      await step(renderer, 1, 1 / 120);
      if (steps.length !== before || steps.length < 2) continue;

      const previous = steps[steps.length - 2];
      const current = steps[steps.length - 1];
      const midway = previous.clone().lerp(current, 0.5);
      checked.push(rendered(80).distanceTo(midway));
      expect(current.distanceTo(previous)).toBeGreaterThan(1e-3);
    }

    expect(checked.length).toBeGreaterThan(5);
    for (const distance of checked) expect(distance).toBeLessThan(1e-4);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("useSoftBody controls", () => {
  it("pushes a hanging cloth downwind", async () => {
    const drift = async (wind?: [number, number, number]) => {
      reset();
      const geometry = new PlaneGeometry(2, 2, 8, 8);
      const renderer = await renderPhysics(
        <Soft
          geometry={geometry}
          position={[0, 3, 0]}
          pinned={(point) => point.y > 0.99}
          mass={2}
          wind={wind}
        />,
      );
      await step(renderer, 120);
      const bottom = soft().getVertex(80);
      await unmount(renderer);
      return bottom.z;
    };

    const still = await drift();
    const blown = await drift([0, 0, 8]);
    expect(Math.abs(still)).toBeLessThan(0.05);
    expect(blown).toBeGreaterThan(0.5);
    expectNoAsserts();
  });

  it("never lets air drag throw a light, fast cloth backwards", async () => {
    reset();
    const renderer = await renderPhysics(
      <Soft geometry={sheet()} position={[0, 5, 0]} mass={0.05} gravityFactor={0} />,
      { timeStep: 1 / 30 },
    );
    await step(renderer, 1, 1 / 30);
    soft().setLinearVelocity([0, 40, 0]);

    let fastest = 0;
    let lowest = Infinity;
    for (let frame = 0; frame < 20; frame += 1) {
      await step(renderer, 1, 1 / 30);
      const { body } = soft();
      const jolt = getApi().Jolt;
      const layout = softBodyVertices(jolt, body);
      let rising = 0;
      for (let index = 0; index < layout.count; index += 1) {
        const at = layout.velocity + index * layout.stride;
        fastest = Math.max(fastest, Math.hypot(jolt.HEAPF32[at], jolt.HEAPF32[at + 1], jolt.HEAPF32[at + 2]));
        rising += jolt.HEAPF32[at + 1] / layout.count;
      }
      lowest = Math.min(lowest, rising);
    }

    // Drag slows the sheet towards still air, and never past it.
    expect(fastest).toBeLessThanOrEqual(40.01);
    expect(lowest).toBeGreaterThan(0);
    expect(soft().getVertex(0).y).toBeGreaterThan(5);

    // An impulse spreads over the whole mass: 0.05 kg·m/s on 0.05 kg is 1 m/s.
    soft().setLinearVelocity([0, 0, 0]);
    soft().applyImpulse([0.05, 0, 0]);
    const before = soft().getVertex(40).x;
    await step(renderer, 1, 1 / 30);
    expect((soft().getVertex(40).x - before) * 30).toBeCloseTo(1, 1);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("takes pressure, setWind and pins live", async () => {
    reset();
    const geometry = new PlaneGeometry(2, 2, 8, 8);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} position={[0, 3, 0]} pinned={[0, 8]} />,
    );
    await step(renderer, 60);

    soft().setWind([8, 0, 0]);
    await step(renderer, 30);
    soft().setWind([0, 0, 0]);

    const target = new Vector3(2, 5, 1);
    soft().pin(40, true);
    soft().setVertex(40, target);
    await step(renderer, 30);
    expect(soft().getVertex(40).distanceTo(target)).toBeLessThan(1e-4);

    soft().pin(40, false);
    await step(renderer, 30);
    expect(soft().getVertex(40).y).toBeLessThan(target.y - 0.1);

    await updatePhysics(
      renderer,
      <Soft geometry={geometry} position={[0, 3, 0]} pinned={[0, 8]} pressure={50} />,
    );
    expect(softBodyMotion(getApi().Jolt, soft().body).GetPressure()).toBe(50);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("is hit by rays, and faceOf names the triangle", async () => {
    reset();
    const geometry = sheet(4);
    const renderer = await renderPhysics(
      <Soft geometry={geometry} position={[0, 1, 0]} pinned={() => true} />,
    );
    await step(renderer, 2);

    const api = getApi();
    const ray = createRaycastContext(api, api.layers.LAYER_MOVING);
    const collector = new api.Jolt.CastRayClosestHitCollisionCollector();
    ray.aim([0.3, 5, 0.6], [0, -10, 0]);
    ray.cast(collector);
    expect(collector.HadHit()).toBe(true);

    const hit = ray.fill(createHit(), collector.get_mHit());
    expect(hit.bodyID).toBe(soft().body.GetID().GetIndexAndSequenceNumber());
    expect(hit.point.y).toBeCloseTo(1, 4);

    const triangle = soft().faceOf(hit.subShapeID);
    expect(soft().faceOf(0)).toBe(-1);
    const index = geometry.getIndex();
    if (!index) throw new Error("PlaneGeometry is indexed");
    const corners = [0, 1, 2].map((corner) =>
      rendered(index.getX(triangle * 3 + corner)),
    );
    const xs = corners.map((point) => point.x);
    const zs = corners.map((point) => point.z);
    expect(hit.point.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-5);
    expect(hit.point.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-5);
    expect(hit.point.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-5);
    expect(hit.point.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-5);

    api.Jolt.destroy(collector);
    ray.destroy();
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("soft body contacts", () => {
  it("reports enter, stay and exit on both sides, but not while asleep", async () => {
    reset();
    const geometry = sheet(4);
    const tree = (enabled = true) => (
      <>
        <Floor listen />
        {enabled && (
          <Soft geometry={geometry} position={[0, 0.5, 0]} listen userData={3} />
        )}
      </>
    );
    const renderer = await renderPhysics(tree());

    for (let frame = 0; frame < 900 && !held.soft?.isSleeping(); frame += 1) {
      await step(renderer, 1);
    }
    expect(soft().isSleeping()).toBe(true);
    expect(log.filter((entry) => entry === "soft:enter:7")).toHaveLength(1);
    expect(log.filter((entry) => entry === "floor:enter")).toHaveLength(1);
    expect(log).toContain("soft:stay");
    expect(contacts[0].normal.y).toBeLessThan(-0.9);

    log.length = 0;
    await step(renderer, 60);
    expect(log).toEqual([]);

    soft().setPosition([0, 5, 0]);
    await step(renderer, 3);
    expect(log).toContain("soft:exit");
    expect(log).toContain("floor:exit");

    soft().setPosition([0, 0.2, 0]);
    await step(renderer, 30);
    log.length = 0;
    await updatePhysics(renderer, tree(false));
    await step(renderer, 1);
    expect(log).toEqual(["floor:exit"]);

    await unmount(renderer);
    expectNoAsserts();
  });

  it("reads the contact flag where the layout says it is", async () => {
    reset();
    let checked = 0;
    let touching = 0;
    // Counted rather than asserted: a throw inside a Jolt callback hangs wasm.
    let mismatched = 0;

    const Compare = () => {
      useSoftBodyContactListener({
        onSoftBodyContactAdded: (_softBody, manifold) => {
          const jolt = getApi().Jolt;
          const vertices = manifold.GetVertices();
          for (let index = 0; index < vertices.size(); index += 1) {
            const vertex = vertices.at(index);
            const flag = jolt.HEAPU8[jolt.getPointer(vertex) + HAS_CONTACT_BYTE];
            if (flag !== 0 !== manifold.HasContact(vertex)) mismatched += 1;
            checked += 1;
            if (flag !== 0) touching += 1;
          }
        },
      });
      return null;
    };

    const geometry = sheet(4);
    geometry.rotateZ(0.3);
    const renderer = await renderPhysics(
      <>
        <Floor />
        <Compare />
        <Soft geometry={geometry} position={[0, 0.6, 0]} />
      </>,
    );
    await step(renderer, 40);

    expect(mismatched).toBe(0);
    expect(touching).toBeGreaterThan(0);
    expect(touching).toBeLessThan(checked);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a sensor see a cloth", async () => {
    reset();

    const Sensor = () => {
      const [, api] = useBox({
        size: [4, 2, 4],
        position: [0, 0, 0],
        motionType: "static",
        sensor: true,
      });
      useSensor(api?.body, {
        onIntersectionEnter: () => log.push("sensor:enter"),
        onIntersectionExit: () => log.push("sensor:exit"),
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor y={-0.5} />
        <Sensor />
        <Soft geometry={sheet(4)} position={[0, 3, 0]} allowSleeping={false} />
      </>,
    );
    await step(renderer, 90);
    expect(log).toContain("sensor:enter");

    log.length = 0;
    soft().setPosition([0, 10, 0]);
    await step(renderer, 3);
    expect(log).toEqual(["sensor:exit"]);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("lets a raw listener reject a contact", async () => {
    reset();
    let added = 0;

    const Reject = () => {
      useSoftBodyContactListener({
        onSoftBodyContactValidate: () => false,
        onSoftBodyContactAdded: () => {
          added += 1;
        },
      });
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <Floor />
        <Reject />
        <Soft geometry={sheet(4)} position={[0, 1, 0]} />
      </>,
    );
    await step(renderer, 90);

    expect(soft().getVertex(0).y).toBeLessThan(-1);
    expect(added).toBe(0);
    await unmount(renderer);
    expectNoAsserts();
  });
});

describe("soft bodies in the world", () => {
  it("lets a character walk through cloth that its inner body pushes aside", async () => {
    const walk = async (collideWithSoftBodies?: boolean) => {
      reset();
      const forward = new Vector3(0, 0, -1);
      const character: { api?: CharacterApi } = {};

      const Walker = () => {
        const [api] = useCharacter({
          position: [0, 0, 1.5],
          innerBody: true,
          collideWithSoftBodies,
        });
        useEffect(() => {
          character.api = api;
        }, [api]);
        useFrame(function walkForward(_, delta) {
          api?.update(forward, false, false, Math.min(delta, 1 / 30));
        });
        return null;
      };

      const renderer = await renderPhysics(
        <>
          <Floor />
          <Soft
            geometry={new PlaneGeometry(3, 2.5, 20, 16)}
            position={[0, 2.75, -3]}
            pinned={(point) => point.y > 1.24}
            mass={2}
            bendCompliance={0.1}
          />
          <Walker />
        </>,
      );

      // The middle of the bottom edge: how far the curtain was pushed back.
      let pushed = 0;
      for (let frame = 0; frame < 240; frame += 1) {
        await step(renderer, 1);
        pushed = Math.min(pushed, soft().getVertex(16 * 21 + 10).z + 3);
      }

      const z = character.api?.character.GetPosition().GetZ() ?? 0;
      await unmount(renderer);
      return { z, pushed };
    };

    const through = await walk();
    expect(through.z).toBeLessThan(-4);
    expect(through.pushed).toBeLessThan(-0.5);

    const blocked = await walk(true);
    expect(blocked.z).toBeGreaterThan(-3);
    expectNoAsserts();
  });

  it("floats a ball in a water volume", async () => {
    reset();
    const renderer = await renderPhysics(
      <>
        <Floor y={-4} />
        <WaterVolume
          position={[0, -2, 0]}
          size={[10, 4, 10]}
          buoyancy={3}
          linearDrag={3}
        />
        <Soft
          geometry={new SphereGeometry(0.5, 12, 8)}
          position={[0, 1, 0]}
          pressure={1000}
          onEnterWater={() => log.push("wet")}
        />
      </>,
    );
    await step(renderer, 400);

    const box = soft().geometry.boundingBox;
    const centre = (box?.getCenter(new Vector3()).y ?? 0) + (held.mesh?.position.y ?? 0);
    expect(log).toEqual(["wet"]);
    expect(centre).toBeGreaterThan(-0.6);
    expect(centre).toBeLessThan(0.5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("is drawn by <PhysicsDebug> from its moving vertices", async () => {
    reset();

    const CaptureScene = () => {
      const scene = useThree((state) => state.scene);
      useEffect(() => {
        held.scene = scene;
      }, [scene]);
      return null;
    };

    const renderer = await renderPhysics(
      <>
        <CaptureScene />
        <PhysicsDebug />
        <Soft
          geometry={sheet(4)}
          position={[0, 3, 0]}
          pinned={(point) => point.x < -0.99}
        />
      </>,
      { interpolate: false },
    );
    await step(renderer, 60);

    const count = soft().vertexCount;
    const meshes = (held.scene?.children ?? []).filter(
      (child): child is Mesh =>
        child instanceof Mesh &&
        child.geometry.getAttribute("position")?.count === count &&
        child !== held.mesh,
    );
    expect(meshes).toHaveLength(1);

    const [debug] = meshes;
    const drawn = new Vector3()
      .fromBufferAttribute(debug.geometry.getAttribute("position"), 24)
      .add(debug.position);
    expect(drawn.distanceTo(soft().getVertex(24))).toBeLessThan(1e-5);
    expect(drawn.y).toBeLessThan(2.5);

    await unmount(renderer);
    expectNoAsserts();
  });
});
