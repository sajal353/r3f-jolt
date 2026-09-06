# r3f-jolt

Jolt Physics hooks for React Three Fiber.

[![Version](https://img.shields.io/npm/v/r3f-jolt?style=flat)](https://www.npmjs.com/package/r3f-jolt)
[![Downloads](https://img.shields.io/npm/dt/r3f-jolt.svg?style=flat)](https://www.npmjs.com/package/r3f-jolt)

## Requirements

| Peer                  | Range          |
| --------------------- | -------------- |
| `react` / `react-dom` | `>=19 <19.3`   |
| `@react-three/fiber`  | `^9`           |
| `three`               | `>=0.156`      |
| `jolt-physics`        | `^1.1.0`       |

React 19 and R3F 9 are required — R3F 8 cannot run on React 19.

## Install

`jolt-physics` is a **peer** dependency, so you install it yourself. That is what lets you pick the WASM build (see [Choosing a Jolt build](#choosing-a-jolt-build)).

```bash
pnpm add r3f-jolt jolt-physics
```

## Quick start

```tsx
import { Canvas } from "@react-three/fiber";
import { Physics, useBox } from "r3f-jolt";

const Floor = () => {
  const [ref] = useBox({
    size: [50, 1, 50],
    position: [0, -0.5, 0],
    motionType: "static",
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[50, 1, 50]} />
      <meshStandardMaterial />
    </mesh>
  );
};

const Crate = () => {
  const [ref] = useBox({
    size: [1, 1, 1],
    position: [0, 8, 0],
    motionType: "dynamic",
    mass: 20,
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshNormalMaterial />
    </mesh>
  );
};

export default () => (
  <Canvas>
    <ambientLight />
    <Physics>
      <Floor />
      <Crate />
    </Physics>
  </Canvas>
);
```

Every body hook returns `[ref, api]`. Attach `ref` to the mesh you want driven by the body; `api` is `undefined` on the first render and populated once the body exists.

## Concepts

Read this section once — it explains most of the surprises.

### Props are read at mount

Body hooks create a Jolt body when they mount and **ignore later prop changes**. Creating a body is expensive, and silently rebuilding one mid-flight loses its velocity and contacts. To rebuild a body from new props, change the component's `key`:

```tsx
<Crate key={size.join(",")} size={size} />
```

Anything you want to change at runtime lives on the `api` or on `<Physics>` (`gravity`, `paused`, `debug`).

### `api` is `undefined` on the first render

The body is created in an effect, so guard on it:

```tsx
const [ref, api] = useConvex({ vertices, position: [0, 5, 0], motionType: "dynamic" });

useFrame(() => {
  if (!api) return;
  // …
});

return api ? <mesh ref={ref} geometry={api.geometry} /> : null;
```

Once it exists, every method on it is also safe to call after the body has been killed or the world torn down — they no-op rather than reaching into a dead world. The `undefined` check is only about the first render.

### `<Physics>` renders nothing until the WASM module resolves

Loading Jolt is asynchronous. `<Physics>` returns `null` until the module is ready, so its children never mount early and no hook inside it runs against a missing world. It does not suspend, so it needs no `<Suspense>` boundary — but anything of yours that *does* suspend (`useGLTF`) still needs its own.

### Stepping happens before syncing

`<Physics>` steps the world on `useFrame` with priority `-1`, which runs ahead of every body's transform sync at the default priority, so meshes always show post-step transforms. The priority stays negative on purpose: R3F hands rendering over to a subscriber only when priority is greater than zero.

### Fixed timestep

The world advances in fixed `timeStep` increments (default `1/60`) drawn from an accumulator, so simulation is independent of frame rate. At most `maxSubSteps` (default `4`) steps run per frame; beyond that the accumulator is dropped rather than spiralling. Pass `timeStep="vary"` for frame-delta stepping.

### Interpolation

A fixed timestep almost never lines up with the display's refresh rate: at 60 Hz physics and 144 Hz rendering, most frames have no new simulation state to show. Snapping to the last step makes a body advance on some frames and not others, which reads as judder even though the simulation itself is perfectly smooth.

`interpolate` (on by default) renders each body between the last two steps instead, using the leftover accumulator as the blend factor.

The cost is **one step of latency** — what you see is the world as it was up to `timeStep` seconds ago. That is invisible for scenery and physics props, but if you are drawing a crosshair on a body the player is aiming at, read `api.body.GetPosition()` directly rather than the mesh transform, or turn interpolation off:

```tsx
<Physics interpolate={false}>
```

It is forced off for `timeStep="vary"`, which already lands exactly one step on every frame and so has no gap to fill.

Static bodies are never interpolated, and a body that has just been created or teleported with `setPositionAndRotation` snaps rather than sliding in from where it used to be.

### Units

Jolt is tuned for metres, kilograms and seconds. A 1-unit cube weighing 20 is a sensible crate. Very small or very large shapes need solver tuning; prefer scaling your world to metres.

## `<Physics>`

| Prop                | Default           | Notes                                             |
| ------------------- | ----------------- | ------------------------------------------------- |
| `gravity`           | `[0, -9.81, 0]`   | Live — changing it calls `SetGravity`             |
| `paused`            | `false`           | Stops stepping; bodies stay alive                 |
| `debug`             | `false`           | Default for every child hook's `debug`. Read once, at mount |
| `timeStep`          | `1/60`            | Or `"vary"` for frame-delta stepping              |
| `interpolate`       | `true`            | Render between steps; ignored when `timeStep="vary"` |
| `maxSubSteps`       | `4`               | Fixed steps allowed per frame                     |
| `collisionSteps`    | `1`               | Collision sub-steps passed to `Step`              |
| `broadPhaseLayers`  | static + moving   | See [Collision groups](#collision-groups-and-masks) |
| `maxBodies`         | Jolt's default    | Hard cap on bodies in the world; sized at construction |
| `maxBodyPairs`      | Jolt's default    | Broadphase pair cap                               |
| `maxContactConstraints` | Jolt's default | Contact constraint cap                            |
| `maxWorkerThreads`  | Jolt's default    | Only a `…-multithread` build has threads to create |
| `physicsSettings`   | —                 | Solver and sleep settings, [below](#solver-settings). Live |
| `updatePriority`    | `-1`              | Where the step sits in R3F's frame. Must stay negative     |
| `updateLoop`        | `"follow"`        | `"independent"` takes the world off the frame loop, [below](#stepping-it-yourself) |
| `module`            | —                 | An already-initialised Jolt module                |
| `init`              | `wasm-compat`     | A custom module initialiser                       |
| `settingsOverride`  | —                 | `(settings, jolt) => void`, applied last          |

Everything above the `physicsSettings` row except `gravity`, `paused` and `physicsSettings` is read when the world is built. Changing one afterwards does nothing until the world is rebuilt, which you do by giving `<Physics>` a new `key`.

`debug` is the sharpest edge of that: every hook reads it at mount, so changing it *does* take effect — by destroying and rebuilding every body in the world, which drops them back to their starting transforms. Reach for [`<PhysicsDebug />`](#physicsdebug--everything-in-the-world) instead, which is a live toggle and draws more.

### Solver settings

`physicsSettings` is applied over whatever the world was built with, so an option you do not name keeps Jolt's default rather than becoming zero. Unlike the caps above it is live: change a value and it takes effect on the next step.

```tsx
<Physics physicsSettings={{ numVelocitySteps: 10, numPositionSteps: 2 }}>…</Physics>
```

The names map one-to-one onto Jolt's `PhysicsSettings` fields with the `m` prefix dropped: `numVelocitySteps`, `numPositionSteps`, `baumgarte`, `speculativeContactDistance`, `penetrationSlop`, `linearCastThreshold`, `linearCastMaxPenetration`, `manifoldTolerance`, `maxPenetrationDistance`, `minVelocityForRestitution`, `timeBeforeSleep`, `pointVelocitySleepThreshold`, `deterministicSimulation`, `constraintWarmStart`, `useBodyPairContactCache`, `useManifoldReduction`, `useLargeIslandSplitter`, `allowSleeping`, `checkActiveEdges`, `maxInFlightBodyPairs`, `stepListenersBatchSize`, `stepListenerBatchesPerJob`.

Removing the prop does not put the previous values back — there is nothing to put back to, since the settings are the world's own. Name the values you want.

Raising `numVelocitySteps` / `numPositionSteps` stiffens *everything* — every joint, every stack, every contact. If one rope is stretchy, the per-constraint `numVelocityStepsOverride` and `numPositionStepsOverride` are the cheaper tool.

### Stepping it yourself

`updateLoop: "independent"` subscribes to no frame at all. The world then advances only through `api.step()`, which runs exactly what a frame runs — the same accumulator, the same [step callbacks](#step-callbacks), the same event flushes.

```tsx
const { step, timing } = useJolt();

<button onClick={() => step()}>step once</button>   // one `timeStep`
<button onClick={() => step(1 / 10)}>a tenth of a second</button>
```

`step(delta)` feeds `delta` through the accumulator, so it runs as many fixed steps as fit and keeps the remainder — `step()` with no argument is exactly one. It does nothing while `paused`.

**`frameloop="demand"` works out of the box.** On demand, R3F draws a frame only when something asks for one, so a physics world would otherwise freeze mid-fall. `<Physics>` asks for the next frame while any body is awake, and stops asking once they have all gone to sleep — which is the point of demand rather than a workaround for it.

`updatePriority` must stay **negative**. R3F hands rendering to the subscriber the moment any `useFrame` priority is above zero, so a positive value means nothing draws the scene unless you draw it yourself; the library warns if you set one.

## Collision groups and masks

Jolt object layers are built from a **group** and a **mask**: what a body *is*, and what it is willing to collide with.

```tsx
const PLAYER = 1 << 2;
const ENEMY = 1 << 3;

useCapsule({
  height: 1.8,
  radius: 0.35,
  position: [0, 4, 0],
  motionType: "dynamic",
  group: PLAYER,
  mask: ENEMY, // collide with enemies only
});
```

Two bodies collide when each one's group appears in the other's mask. Omit `group`/`mask` and bodies use the default static/moving split. `layer` sets a raw object layer if you have built one yourself.

> **Group and mask are 16 bits each**, not 32 — the object layer packs them as `(mask << 16) | group`, so you get 16 collision groups. A 32-bit filter value brought in from elsewhere silently loses its high half.

`interactionGroups(group, mask)` packs the same pair without a `useJolt()` call, for the places that take a raw layer — a query's `layer` option, or a body's:

```tsx
import { interactionGroups } from "r3f-jolt";

useClosestHitRaycaster({ layer: interactionGroups(PLAYER, ENEMY) });
```

It throws on a value past 16 bits rather than dropping the high half quietly.

Broad-phase layers are configured on `<Physics>`, one entry per layer:

```tsx
<Physics broadPhaseLayers={[{ include: STATIC }, { include: PLAYER | ENEMY }]} />
```

### Group filters

Layers decide what a body **is**. Group filters work one level down and decide which **individual** bodies ignore each other — the ragdoll problem, where a forearm and an upper arm overlap by design and must not shove each other apart.

```tsx
const table = useGroupFilterTable(BONES, (t) => {
  for (let i = 0; i < BONES - 1; i += 1) t.disableCollision(i, i + 1);
});

// …then, on each body:
collisionGroup: { filter: table.filter, groupID: RAGDOLL_ID, subGroupID: bone }
```

The rule in one sentence: **two bodies in different groups always collide; two in the same group collide only if the table allows their two sub-groups.** So one table per ragdoll, with a `groupID` of its own, keeps the filtering local to it.

Worth knowing:

- The table is `undefined` on its owner's first render, and a body reads its filter at **creation** — so bodies needing one belong in a child component the owner renders only once the table exists. `api.setCollisionGroup(...)` is the path for a body that already exists.
- `GroupFilterTable` is refcounted. The hook holds one reference and releases it on unmount; every body built with it holds its own, so a table outlives its owner if bodies still reference it. Do not `destroy()` one yourself.
- This is orthogonal to layers. A filter cannot make two bodies collide that their layers already keep apart.

## Choosing a Jolt build

`jolt-physics` ships several builds. The default is `wasm-compat`, which works everywhere. Override it with `init` (lazy) or `module` (already initialised):

```tsx
import initJolt from "jolt-physics/wasm";

<Physics init={() => initJolt()}>…</Physics>;
```

| Entry point                     | Use for                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `jolt-physics/wasm-compat`      | Default; broadest bundler and browser support                        |
| `jolt-physics/wasm`             | Smaller and faster, needs a bundler that emits the `.wasm` asset     |
| `jolt-physics/asm`              | No WASM at all; slow, last resort                                    |
| `jolt-physics/debug-wasm-compat`| Assertions on. Catches double frees and bad parameters — use in tests |
| `…-multithread` variants        | Multithreaded, see below                                             |

The multithreaded builds need `SharedArrayBuffer`, which requires **COOP/COEP headers** on the host:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Many static hosts do not set these, and without them the multithreaded build will not start. Cap worker threads with the `maxWorkerThreads` prop:

```tsx
<Physics init={() => initJolt()} maxWorkerThreads={2} />
```

The prop is accepted by every build and ignored by the single-threaded ones, which have no threads to create. Main-thread is the default, and is the right default: the multithreaded builds buy throughput on worlds large enough to need it and cost you the header requirement above on every page that loads them.

Modules are cached per initialiser, so mounting several `<Physics>` trees instantiates the WASM once.

## Body hooks

`useBox` · `useSphere` · `useCapsule` · `useCylinder` · `useTaperedCapsule` · `useTaperedCylinder` · `useConvex` · `useCompound` · `useTrimesh` · `usePlane` · `useHeightField` · `useEmpty` · `useAutoCollider`

Plus [`useInstancedBodies`](#useinstancedbodies--one-mesh-one-shape-many-bodies) for many bodies of one kind.

All of them take these options and return `[ref, api]`.

### Shared options

| Option                     | Default                     | Notes                                              |
| -------------------------- | --------------------------- | -------------------------------------------------- |
| `position`                 | —                           | `[x, y, z]`                                        |
| `rotation`                 | `[0, 0, 0, 1]`              | Quaternion                                         |
| `motionType`               | —                           | `"static"`, `"kinematic"` or `"dynamic"`           |
| `mass`                     | Jolt's density-derived mass | Dynamic bodies only; ignored on the others         |
| `massProperties`           | —                           | `{ mass?, inertia? }` — full control, see below     |
| `overrideMassProperties`   | narrowest that fits         | `"calculateMassAndInertia"` · `"calculateInertia"` · `"massAndInertiaProvided"` |
| `scale`                    | —                           | `[x, y, z]`, applied to the collider at creation    |
| `material`                 | —                           | `{ friction?, restitution? }`; `0` is respected    |
| `initialVelocity`          | —                           | `[x, y, z]`, applied at creation                   |
| `initialAngularVelocity`   | —                           | `[x, y, z]`, applied at creation                   |
| `debug`                    | `<Physics debug>`           | Wireframe of the real collider                     |
| `enabled`                  | `true`                      | `false` creates the body without adding it         |
| `userData`                 | —                           | 32-bit uint, readable in contact handlers          |
| `shapeUserData`            | —                           | 32-bit uint, set on the shape                      |
| `motionQuality`            | `"discrete"`                | `"linearCast"` for fast movers                     |
| `group` / `mask` / `layer` | static/moving split         | See [Collision groups](#collision-groups-and-masks) |
| `collisionGroup`           | —                           | `{ filter?, groupID?, subGroupID? }` — which individuals ignore each other |
| `allowDynamicOrKinematic`  | `false`                     | Required to promote a **static** body later        |
| `sensor`                   | `false`                     | Reports contacts, imparts no impulse               |
| `linearDamping`            | `0.05`                      | Jolt's default; set `0` for exact impulse maths    |
| `angularDamping`           | `0.05`                      |                                                    |
| `gravityFactor`            | `1`                         | `0` makes a body float                             |
| `allowSleeping`            | `true`                      |                                                    |
| `onWake` / `onSleep`       | —                           | Delivered after the step, not from inside it       |
| `allowedDOFs`              | all six                     | Raw `EAllowedDOFs` bit mask                        |
| `lockRotations` / `lockTranslations` | `false`           | Ergonomic wrappers over `allowedDOFs`              |
| `enabledRotations` / `enabledTranslations` | —         | `[x, y, z]` booleans                               |
| `enhancedInternalEdgeRemoval` | `false`                  | Kills ghost bumps when sliding over trimesh terrain |
| `applyGyroscopicForce`     | `false`                     | Spinning bodies precess                            |
| `collideKinematicVsNonDynamic` | `false`                 | Lets a sensor see kinematic and static bodies      |
| `maxLinearVelocity` / `maxAngularVelocity` | Jolt's caps | Clamps a runaway body                              |
| `numVelocityStepsOverride` / `numPositionStepsOverride` | global | Per-body solver iterations           |
| `bodySettingsOverride`     | —                           | `(settings) => void` before the body is created    |

`userData` is **32-bit** — Jolt narrowed it from 64-bit because WebIDL could not marshal 64-bit integers. Larger ids truncate; the library warns in development.

**Kinematic bodies** are moved by you, not by forces, and push dynamic bodies out of the way. Drive them with `moveKinematic` — see [Moving things by hand](#moving-things-by-hand).

**DOF locks are world-space, not local-space.** Jolt changed this in 0.18.0 to match other engines. Locking rotation X locks the *world* X axis however the body happens to be oriented, which is not what most people assume.

**`scale` scales the collider, not your mesh.** The hook wraps its shape in a `ScaledShape` — the same one `api.setScale` builds later, so a later `setScale` *replaces* this rather than compounding with it. The hook's own debug mesh is scaled to match; your mesh is yours. Non-uniform scale is invalid on spheres and capsules and is refused with a warning rather than silently corrected.

**`massProperties` supersedes `mass`.** `{ mass }` alone is the same thing the scalar `mass` does. Adding `inertia` — the diagonal of the inertia tensor about the centre of mass, in kg·m² — is the only way to make a body resist rotation differently from how its shape says it should: a hollow shell, a weighted die, a flywheel. Both survive a `setScale`, which would otherwise recompute them from density × the new volume.

Jolt has **no centre-of-mass override**. That comes from the shape, so shift it by building a `useCompound` whose child sits off-centre. And Jolt stores a full inertia tensor but hands it back eigen-decomposed into a diagonal plus a rotation, with the diagonal sorted — the three numbers survive a round trip while their order does not.

**`allowDynamicOrKinematic` cannot be added later.** A static body created without it has no `MotionProperties` at all, so nothing can promote it afterwards. `setMotionType` and `grab` refuse with a warning rather than letting Jolt corrupt memory — in a release build the assertion that catches this is compiled out.

### Shape-specific options

| Hook                | Options                                          |
| ------------------- | ------------------------------------------------ |
| `useBox`            | `size: [x, y, z]`, `convexRadius?`               |
| `useSphere`         | `radius`, `segments?`                            |
| `useCapsule`        | `height`, `radius`, `segments?`                  |
| `useCylinder`       | `height`, `radius`, `convexRadius?`, `segments?` |
| `useTaperedCapsule` | `topRadius`, `bottomRadius`, `height`            |
| `useTaperedCylinder`| `topRadius`, `bottomRadius`, `height`, `convexRadius?`, `renderSegments?` |
| `useConvex`         | `vertices: number[][]`                           |
| `useCompound`       | `shapes: CompoundChild[]`                        |
| `useTrimesh`        | `mesh: BufferGeometry \| { position, index? }`, `buildQuality?`, `triangleUserData?` |
| `usePlane`          | `normal?`, `constant?`, `point?`, `halfExtent?`, `renderSize?`, `renderSegments?` |
| `useHeightField`    | `heights`, `sampleCount`, `offset?`, `sampleScale?`, `blockSize?`, `bitsPerSample?`, `range?`, `materialIndices?` |
| `useEmpty`          | `centerOfMass?`                                  |

`convexRadius` defaults to a value derived from the shape's size rather than a fixed `0.05`, which was wrong on small shapes.

`useTrimesh` accepts a `BufferGeometry` directly and derives the index when the geometry is non-indexed. **A trimesh body is always static** — Jolt mesh shapes cannot be dynamic.

`useCompound` children are `{ type, position, rotation?, … }` where `type` is `box`, `sphere`, `capsule`, `cylinder`, `taperedCapsule` or `convex`. An invalid child is skipped with a console error and the rest of the compound still builds.

`useTaperedCylinder` is a cylinder with two radii, and with one of them at zero it is a cone. Flat ends are the whole difference from `useTaperedCapsule`: this stands where a tapered capsule rolls.

`useEmpty` is a body with no collision at all. It moves, sleeps, carries velocity and can be jointed to — it simply never touches anything, which makes it the anchor a one-sided constraint cannot be (that one bolts to the world and cannot move). `api.geometry` is empty, so bring your own mesh.

#### `usePlane` — the ground

**Jolt's plane is not infinite.** It is a half space bounded by `halfExtent`, whose Jolt default is **1000** — and `<PhysicsDebug />` triangulates every body in the world, so leaving it there paints a two-kilometre wireframe quad over your scene. This hook defaults it to **100** instead, and sizes the render mesh separately with `renderSize` (default 20):

```tsx
const [ref, api] = usePlane({ position: [0, 0, 0], motionType: "static" });

return <mesh ref={ref} geometry={api?.geometry} receiveShadow />;
```

The plane is every point where `dot(normal, x) + constant` is zero, so a surface one unit **above** the body's origin has a `constant` of `-1`. Pass `point` instead if that is the wrong way round for you. The render geometry is baked to the plane's orientation and offset, so the mesh needs no transform of its own.

#### `useHeightField` — terrain

Samples are quantised into blocks with a per-block range, so both the shape and the queries walk far less memory than the equivalent `useTrimesh`.

`heights` takes three shapes, all indexed the same way — `z * sampleCount + x`, with sample `(0, 0)` at `offset`:

```tsx
// a function, called once per sample; `null` is a hole
useHeightField({ heights: (x, z) => noise(x, z), sampleCount: 128 });

// a row-major array, `sampleCount²` long; `NaN` is a hole
useHeightField({ heights: loadedFloats, sampleCount: 128 });

// greyscale image data — RGBA reads the red channel
useHeightField({
  heights: { data: imageData, heightRange: [0, 16] },
  sampleCount: 128,
});
```

Worth knowing:

- **`sampleCount` must be a multiple of `blockSize`**, and `blockSize` a power of two in [2, 8]. Both are checked with a readable error rather than left to a Jolt assert.
- **`range` is the span the field can *store*.** It defaults to the span of the samples you gave it, which means `setHeights` can never push a sample outside the terrain's own extremes — silently clamped, not warned. Widen it now for terrain that will be deformed later.
- **`getHeights` and `setHeights` work in whole blocks.** `x`, `z`, `sizeX` and `sizeZ` must all be multiples of `blockSize`. Jolt only asserts on this in a debug build; in a release build a misaligned region reads past the end of the heap, so the hook refuses instead.
- An 8-bit `bitsPerSample` over a wide `range` is 256 discrete steps however precise the samples were, and terrain terraces visibly when the two are mismatched.
- Render geometry is the collider's own triangulation, and `setHeights` regenerates it in place, so the mesh and the physics cannot drift apart.

### Returned api

`api` is `undefined` until the body exists. Once it does, every method below also no-ops if the body has been killed or the world torn down, so a handler that fires during teardown is safe.

Vectors take a three `Vector3` or a `[x, y, z]` tuple; rotations take a `Quaternion` or `[x, y, z, w]`. Arguments are converted into pooled Jolt temporaries, so none of these allocate.

| Field                                   | Notes                                                     |
| --------------------------------------- | --------------------------------------------------------- |
| `body`                                  | `Jolt.Body`                                               |
| `shape`                                 | The **base** shape (see below)                            |
| `geometry`                              | A `BufferGeometry` matching the collider, disposed on unmount |
| `debugMesh`                             | The wireframe mesh, or `null`                             |
| `kill()` / `revive()`                   | Remove from / add back to the simulation without unmounting |
| `setEnabled(bool)`                      | The same pair, as one call                                |
| **Forces** — Jolt spells these `Add*`   |                                                           |
| `applyForce(force, point?)`             | Accumulates for one step                                  |
| `applyTorque(torque)`                   |                                                           |
| `applyForceAndTorque(force, torque)`    |                                                           |
| `applyImpulse(impulse, point?)`         | Instant velocity change                                   |
| `applyAngularImpulse(impulse)`          |                                                           |
| **State**                               |                                                           |
| `setLinearVelocity` / `setAngularVelocity` |                                                        |
| `setVelocities(linear, angular)`        | Both in one call                                          |
| `setPositionAndRotation(p, r, activate?)` | A **teleport** — no implied velocity                    |
| `setMotionType(type)`                   | Refuses an illegal promotion, see above                   |
| `setLayer(layer)` / `setGravityFactor(f)` |                                                         |
| `setCollisionGroup(group)`              | `{ filter?, groupID?, subGroupID? }` — see [Group filters](#group-filters) |
| `sleep()` / `wake()` / `isSleeping()`   |                                                           |
| `resetSleepTimer()`                     |                                                           |
| **Manual control**                      | See [Picking things up](#picking-things-up)               |
| `grab()` / `release()` / `isGrabbed()`  |                                                           |
| `moveKinematic(p, r, deltaTime?)`       | The correct way to drive a kinematic body                 |
| `moveTo(p, r, deltaTime?)`              | The same call, named for a grab loop                      |
| `setScale(scale, updateMassProperties?)` | Replaces the collider with a scaled one                  |
| **Shape-specific** | Only on the hooks that can support them                                |
| `setMaterial(m)` / `getMaterial()` | `usePlane` and `useConvex` — see below                 |
| `getTriangleUserData(subShapeID)` | `useTrimesh`                                            |
| `getMinHeight()` / `getMaxHeight()` / `getHeight(x, z)` | `useHeightField`                  |
| `getHeights(...)` / `setHeights(...)` / `isNoCollision(x, z)` | `useHeightField`            |

`shape` is the shape the hook built and owns. After a `setScale` the body is running on a `ScaledShape` wrapping it, so `shape` is no longer the body's own shape — read `bodyInterface.GetShape(api.body.GetID())` if you need that.

### Identifying surfaces

Two mechanisms, for two different shapes of problem — footstep audio, per-surface tyre grip, decals.

**Per triangle, on a mesh.** `useTrimesh`'s `triangleUserData` tags every triangle with a 32-bit number, either as an array or as a function of the triangle index. Read it back off any hit through the `subShapeID` the hit carries:

```tsx
const [ref, api] = useTrimesh({ mesh, triangleUserData: (i) => surfaceOf(i) });

const hit = raycaster?.cast(origin, direction);
if (hit?.hit) console.log(SURFACES[api.getTriangleUserData(hit.subShapeID)]);
```

**Per shape, on a plane or a hull.** `setMaterial` takes a `Jolt.PhysicsMaterial`, which binds a refcount and **nothing else** — no friction, no restitution, no name. It is an identity token: hand one to a shape, read it back with `getMaterial()` or `bodyInterface.GetMaterial(bodyID, subShapeID)`, and compare pointers. Friction and restitution live on the body (`material` on any body hook) and are not per-surface. Only `ConvexShape` and `PlaneShape` bind `SetMaterial`, which is why only those two hooks carry it. The shape takes a reference, so a freshly-made material needs no `AddRef` from you and must **not** be destroyed.

## Many bodies, and colliders you do not write twice

### `useAutoCollider` — the collider comes off the mesh

Every other body hook takes its size as an option, which means the number lives in two places: in the hook, and in the geometry the mesh draws. They drift apart silently. `useAutoCollider` reads the collider off the mesh instead, so it is written once.

```tsx
const [ref, api] = useAutoCollider({
  collider: "box",
  position: [0, 5, 0],
  motionType: "dynamic",
});

<mesh ref={ref} scale={[2, 2, 2]}>
  <boxGeometry args={[1.4, 1.4, 1.4]} />   {/* the only size in the file */}
  <meshStandardMaterial />
</mesh>
```

| `collider` | Derived from                       | Notes                                        |
| ---------- | ---------------------------------- | -------------------------------------------- |
| `"box"`    | `geometry.boundingBox`             | The default                                  |
| `"sphere"` | `geometry.boundingSphere`          | Coarse on anything that is not round         |
| `"hull"`   | The position attribute             | What a dynamic body wants for a complex mesh |
| `"trimesh"`| The triangles themselves           | **Static only** — Jolt does not move a mesh  |

- **The mesh's own `scale` is applied.** Half-extents and hull points are multiplied through it. A sphere cannot take a non-uniform scale, so it uses the largest axis and says so in a warning; reach for `"hull"` for a squashed shape.
- **Geometry that is not centred on its origin is handled**, not ignored. A mesh modelled with its feet at zero gets a `RotatedTranslatedShape` so the collider sits over the mesh rather than half a body below it.
- Everything else is an ordinary body: the whole of the [shared options](#shared-options) and the whole of the [api](#returned-api).
- Read at mount, like every hook. A geometry that changes afterwards needs a new `key`.

### `useInstancedBodies` — one mesh, one shape, many bodies

A body hook is one React component, one mesh and one `useFrame` subscriber per body. That is the right trade up to a few hundred bodies and the wrong one past that. `useInstancedBodies` drives a single `InstancedMesh` instead: one shared Jolt shape, one batched add, one loop writing instance matrices.

```tsx
const [ref, swarm] = useInstancedBodies({
  count: 150,
  collider: { type: "box", size: [0.6, 0.6, 0.6] },
  transforms: (index) => ({ position: [index - 75, 20, 0] }),
  motionType: "dynamic",
});

<instancedMesh ref={ref} args={[undefined, undefined, 150]} frustumCulled={false}>
  <meshStandardMaterial />
</instancedMesh>
```

`collider` is a descriptor — `box`, `sphere`, `capsule`, `cylinder`, `taperedCapsule`, `taperedCylinder`, `convex`, `trimesh`, `compound`, `empty` — with the same fields the matching body hook takes. For anything the descriptors do not cover, pass a function instead: it is the same factory contract the hooks use internally, and it must hand back a shape you own one reference to.

```tsx
collider: (jolt) => {
  const settings = new jolt.SomethingExoticShapeSettings(…);
  const result = settings.Create();
  jolt.destroy(settings);
  const shape = result.Get();
  shape.AddRef();
  result.Clear();
  return { shape, geometry: shapeToGeometry(jolt, shape) };
}
```

Alongside `count`, `collider` and `transforms` it takes `motionType`, `mass`, `massProperties`, `material`, `layer` / `group` / `mask`, `collisionGroup`, `userData` (a value or a function of the index), the damping and sleep options, `activate`, `interpolate`, and `bodySettingsOverride(settings, index)` for the rest.

The api carries `bodies`, `ids`, `count`, the shared `shape` and `geometry`, and `at(index)`:

```tsx
swarm?.at(7)?.applyImpulse([0, 4000, 0]);
```

- **`at(index)` is a deliberate subset of `BodyApi`.** An instance has no mesh and no shape of its own, so the parts of that api about either are absent rather than lying: `setPositionAndRotation`, `setLinearVelocity`, `setAngularVelocity`, `applyImpulse`, `applyForce`, `wake`, `sleep`, `isSleeping`, plus `body`, `id` and `index`. It builds a fresh object per call, so holding one is safe.
- **Instances keep the order `transforms` produced them.** Jolt's batch add sorts the id array it is handed, so the hook keeps its own list: index 7 is always the body transform 7 described.
- **Sleeping instances are skipped.** Reading a transform out of WASM is several boundary crossings; at these counts, paying only for the bodies still moving is the difference that makes the hook worth having. The instance matrix buffer is re-uploaded only when something in that swarm moved.
- **`<PhysicsDebug />` draws every instance**, off one cached geometry. It is still a thousand wireframes: expect it to cost.

## Moving things by hand

There is exactly one rule, and getting it wrong is the most common way to make a physics scene feel dead:

> To **move** a body under your control, use `moveKinematic`. To **teleport** it, use `setPositionAndRotation`.

`setPositionAndRotation` puts the body somewhere with zero velocity. A platform moved that way carries nothing standing on it, and a body carried that way pushes nothing and drops straight down the moment you let go.

`moveKinematic(target, rotation)` instead sets the velocity needed to *arrive* at the target over one step. Jolt then integrates it like any other motion, so it sweeps, pushes and collides properly — and the velocity it built up is still on the body afterwards.

`deltaTime` is optional and defaults to the world's step duration, which is what makes the body land exactly on target. Pass one only to deliberately over- or undershoot, and **do not pass `useFrame`'s delta**: under a fixed timestep that is a different clock, and the error compounds rather than merely scaling — the body overshoots, the next correction is computed from the overshot position, and the drive runs away.

```tsx
const [ref, api] = useBox({ motionType: "kinematic", position: [0, 1, 0] });
const t = useRef(0);

useFrame((_, delta) => {
  t.current += delta;
  api?.moveKinematic([Math.sin(t.current) * 4, 1, 0], [0, 0, 0, 1]);
});
```

## Step callbacks

`useFrame` runs once per rendered frame. A fixed timestep runs however many steps that frame's delta paid for — two, or none, or four. Anything that has to be *integrated* — a force, a thruster, buoyancy, a custom gravity field — has to arrive once per step, or it is applied at the wrong strength and the result depends on the viewer's refresh rate.

```tsx
import { useBeforePhysicsStep, useAfterPhysicsStep } from "r3f-jolt";

const Attracted = () => {
  const [ref, api] = useSphere({ position: [3, 4, 0], gravityFactor: 0 });

  useBeforePhysicsStep(() => {
    api?.applyForce(pullTowards(api.body.GetPosition(), origin));
  });

  useAfterPhysicsStep((delta, index) => {
    // Sampled at the rate the world actually simulates at.
    trail.push(api.body.GetPosition());
  });

  return <mesh ref={ref}>…</mesh>;
};
```

Both take `(delta, index)`: the duration of that step, and its number. `index` is what `api.timing.stepCount` reads while a `before` callback runs, and one less than it reads in the matching `after` one.

**Worth knowing**

- They run **between** Jolt's steps, not inside one. This is not Jolt's `PhysicsStepListener`: no lock is held, so reading positions, applying forces, even creating a body are all fine.
- **Do not call `setState` from one.** A render scheduled from inside the step loop fires once per sub-step, from a `useFrame` at negative priority — the worst place in the frame to schedule one. Write to a ref and read it from a `useFrame` if something on screen has to change.
- Nothing runs while `<Physics paused>`, because nothing is stepping.
- With `timeStep="vary"` there is exactly one step per frame, so these behave like a `useFrame`.
- Subscribers run in the order they mounted. A callback that subscribes another one from inside a step is held until the next step rather than run twice.
- Contact events are still delivered once per frame, after the last step, so a contact made in this step has not been dispatched when your `after` callback runs.

## `useConveyor` — belts, walkways and turntables

A conveyor belt is a body whose *surface* moves while the body stays where it is. Jolt applies this per contact, so it drags only what is actually resting on it.

```tsx
const [ref, api] = useBox({
  position: [0, 0.25, 0],
  size: [3, 0.5, 20],
  motionType: "static",
  material: { friction: 1 },
});

const belt = useConveyor(api, { linear: [0, 0, -5] });

// later
belt?.setLinear([0, 0, 5]);
belt?.stop();
```

`linear` is metres per second and `angular` is radians per second about the body's centre of mass — an `angular`-only belt is a turntable. Both default to zero.

`space` decides how those vectors are read. The default `"local"` rotates them by the belt's own rotation, so a belt laid down at an angle carries along itself; `"world"` takes them as given.

Options are read at mount like every other hook. The returned api is what changes a running belt, and is `undefined` until the body exists.

For a belt that never changes speed, skip the hook and declare it on the body:

```tsx
useBox({
  // …
  surfaceVelocity: { linear: [0, 0, -5] },
});
```

Both routes share one record per body, so a hook on a body that already declared `surfaceVelocity` takes over that belt rather than fighting it.

Three things worth knowing:

- **Friction does the dragging.** A belt with `friction: 0` carries nothing, and a light crate on a slow belt slips before it grips.
- **Sleeping bodies report no contacts at all**, so a crate that dozed off on a stopped belt would never notice it start. `wake` handles this and is on by default; turn it off only if you are managing activation yourself.
- **A `useCharacter` is not carried.** `CharacterVirtual` runs its own contact listener, and Jolt's character contact settings have no surface-velocity field to write.

## Constraints

Eight hooks, one per Jolt constraint type. Each takes two bodies and an options object, and returns `[api]` — `undefined` until both bodies exist, like every other hook here.

```tsx
const Door = () => {
  const [ref, door] = useBox({
    size: [2, 3, 0.2],
    position: [1.3, 2, 0],
    motionType: "dynamic",
    mass: 20,
  });

  const [hinge] = useHingeConstraint(null, door, {
    point: [0, 2, 0],
    hingeAxis: [0, 1, 0],
    normalAxis: [1, 0, 0],
    limits: { min: -Math.PI / 2, max: 0 },
    motor: { state: "position", targetAngle: 0, maxTorqueLimit: 4000 },
  });

  useEffect(() => hinge?.setTargetAngle(open ? -Math.PI / 2 : 0), [hinge, open]);

  return <mesh ref={ref}>{/* … */}</mesh>;
};
```

| Hook | Holds | Leaves free |
| --- | --- | --- |
| `useFixedConstraint` | everything | nothing — a weld |
| `usePointConstraint` | one point | all three rotations |
| `useHingeConstraint` | a point and an axis | one rotation |
| `useSliderConstraint` | orientation and two axes | one translation |
| `useDistanceConstraint` | a distance range | everything else |
| `useConeConstraint` | a point, limits the lean | twist about the axis |
| `useSwingTwistConstraint` | a point, limits lean **and** twist | within the limits |
| `useSixDOFConstraint` | whatever you say | whatever you say |

### The two bodies

Either side takes a body api, a raw `Jolt.Body`, or `null` for the world:

- **`null`** anchors that side to Jolt's fixed world body — a door in a frame that is not itself a body, a chain hanging from nothing. There is no need to create a static body just to have something to join to.
- **`undefined`** means "not ready yet". Body hooks return `undefined` on their first render, so passing one straight through is expected; the joint is created on the render where both bodies exist.

### Points and axes

Every point and axis option comes in three forms: a shared one (`point`, `hingeAxis`) applied to both bodies, and per-body overrides (`point1`/`point2`, `hingeAxis1`/`hingeAxis2`) for the cases where they differ. Values are world-space by default; pass `space: "local"` to give them relative to each body's centre of mass instead.

`useFixedConstraint` and `useSliderConstraint` also accept `autoDetectPoint`, which ignores the points and uses wherever the bodies currently are. It is on by default for the fixed joint, since a weld almost always means "keep these exactly as I placed them".

### Motors

`useHingeConstraint`, `useSliderConstraint`, `useSwingTwistConstraint` and `useSixDOFConstraint` take a `motor`, and expose setters for changing it at runtime:

- **`state: "position"`** drives toward a target and holds it, carrying load. Set `targetAngle` (hinge) or `targetPosition` (slider).
- **`state: "velocity"`** turns or travels at a rate. Set `targetAngularVelocity` or `targetVelocity`.
- **`state: "off"`** releases the joint back to the simulation.
- `maxForceLimit` / `maxTorqueLimit` cap what the motor may apply. Leave them out and the motor is unlimited.
- `spring` decides how hard the motor tracks its target. The default is soft enough that a loaded position motor settles noticeably short of where it was pointed; raise `frequency` (or set `stiffness`) if you want it to arrive.

### Springs and limits

`limits: { min, max }` bounds a hinge (radians) or a slider (metres), and `limitsSpring` makes that bound springy rather than hard. A spring is `{ frequency, damping }` or `{ stiffness, damping }` — setting `stiffness` selects that mode.

### Worth knowing

- **Every runtime setter wakes both bodies.** A settled joint puts its bodies to sleep, and a sleeping body ignores a retargeted motor until something else wakes it. The hooks call Jolt's `ActivateConstraint` for you; `api.activate()` is there if you need it directly.
- **Options are read once at mount**, like the body hooks. Change a joint at runtime through its setters, or rebuild it with `key`.
- **`debug: true`** draws the joint: body 1's centre → its anchor → body 2's anchor → body 2's centre. The middle segment has zero length while the constraint holds, so a visible line there is the solver failing to close the gap. `<PhysicsDebug />` draws every joint in the world the same way, in a single buffer — see [Debug rendering](#debug-rendering).
- **`useFixedConstraint` returns a `TwoBodyConstraint`**, not a `FixedConstraint`. Jolt binds the settings but not the class; nothing is lost, since a weld has no runtime controls.
- **Two joined bodies still collide with each other** unless you keep them apart or filter them. A hinge whose door overlaps its own frame is held open by the contact, not by the joint.

## Picking things up

Grabbing, carrying, resizing and throwing a body — the WebXR "pick it up" case, though nothing here is XR-specific. The library owns no input: these are the same calls a controller, a pointer or a gamepad would drive.

```tsx
const [ref, api] = useBox({ size: [1, 1, 1], position: [0, 1, 0], motionType: "dynamic", mass: 4 });

// Grab: switches to kinematic, remembering what it was.
const onSelectStart = () => api?.grab();

// Carry: drive it, do not teleport it.
useFrame(() => {
  if (api?.isGrabbed()) api.moveTo(controllerPosition, controllerRotation);
});

// Resize while held. Jolt shapes are immutable, so this swaps the collider.
const bigger = () => api?.setScale([1.5, 1.5, 1.5]);

// Release: hands it back to the simulation.
const onSelectEnd = () => api?.release();
```

**The throw is free.** `release()` applies no impulse. The velocity the carry accumulated is already on the body, so letting go while moving throws it in the direction of travel at the speed you were moving. If you want a stronger throw, carry faster or add an `applyImpulse` yourself.

**Grabbing a static body** needs `allowDynamicOrKinematic: true` at creation. Without it `grab()` warns and does nothing.

### Runtime scale

Jolt shapes are immutable, so `setScale` replaces the body's collider with a `ScaledShape`. Three things follow from that:

- It is **always rebuilt from the base shape**, so calls replace rather than compound: `setScale([2,2,2])` twice leaves the body at 2×, not 4×.
- **Non-uniform scale is invalid on spheres and capsules.** `setScale([2,1,1])` on a sphere is refused with a warning naming what Jolt's `MakeScaleValid` would have suggested. Boxes, cylinders and hulls take any scale.
- **An explicit `mass` is preserved.** `SetShape` recomputes mass from density × the new volume, silently discarding what you asked for; the hook reapplies it. Pass `setScale(s, false)` to skip the recompute entirely.

Scale the collider and your mesh together — the hook mirrors the scale onto its own `debugMesh`, but your mesh is yours:

```tsx
const [scale, setScale] = useState(1);
const resize = (next: number) => {
  setScale(next);
  api?.setScale([next, next, next]);
};

return <mesh ref={ref} scale={scale}>…</mesh>;
```

A `useTrimesh` body stays static however you scale it, and a negative scale component on a mesh shape flips its winding.

## Sleep and wake

Jolt deactivates bodies that have come to rest, and reactivates them when something disturbs them. Both are reported per body:

```tsx
const [ref, api] = useBox({
  position: [0, 5, 0],
  motionType: "dynamic",
  onSleep: () => console.log("settled"),
  onWake: () => console.log("disturbed"),
});

api?.isSleeping();
```

Handlers are read fresh on every render, so unlike the creation options they always see the current closure.

Jolt reports activation from *inside* the step, where touching the world is unsafe, so events are queued and delivered right after it — the same deferral contacts use. The listener is only installed while at least one body asks for these, and `allowSleeping: false` opts a body out of sleeping entirely.

## `useCharacter`

A character controller built on `CharacterVirtual`.

```tsx
const [api] = useCharacter({
  position: [0, 4, 0],
  options: {
    height: { standing: 1.8, crouching: 0.9 },
    radius: { standing: 0.35, crouching: 0.35 },
    moveSpeed: 6,
    jumpSpeed: 7,
  },
});

useFrame((_, delta) => {
  api?.update(direction, jump, crouch, Math.min(delta, 1 / 30));
});
```

`update(direction, jump, crouched, deltaTime, options?)` — `direction` is a world-space `Vector3` and is **not** mutated. The trailing options are `{ ignoreHorizontalMovementLock?, addToVelocity?, overrideUpdate? }`.

`options` is optional and deep-merged with the defaults. Alongside the movement settings it exposes `maxSlopeAngle`, `maxStrength`, `characterPadding`, `penetrationRecoverySpeed` and `predictiveContactDistance`. A non-vertical `up` is supported at the top level.

The character's position is its **feet**, so a settled character on a floor whose top face is `y = 0` reports `y ≈ 0`. The shape is swapped only when the crouch state actually changes, and debug meshes track the character every frame whether or not you call `update`.

## `useCar`

A wheeled vehicle built on `VehicleConstraint`.

```tsx
const [api] = useCar({
  position: [0, 2, 0],
  driveType: "awd",
  vehicleSize: { length: 4, width: 1.8, height: 1 },
  wheelSettings: { radius: 0.35, width: 0.28, offsetForward: 1.4, offsetDown: 0.3 },
});

const state = api?.update({ forward, backward, left, right, handbrake, modifier });
```

`update` returns `{ position, rotation, velocity, wheels }`. **The returned object and its vectors are reused between calls** — copy anything you need to keep.

Wheel offsets are named for their axes: `offsetForward` is `+Z` to the front axle, `offsetDown` is the drop from the body centre to the wheel centres. `castType` is `"cylinder"` (default), `"sphere"` or `"ray"`.

### Braking

Braking is independent of `driveType`. The service brake acts on all four wheels, biased towards the front because weight transfers forward under deceleration; the handbrake acts on the **rear axle only**.

| Option            | Default | Notes                                                  |
| ----------------- | ------- | ------------------------------------------------------ |
| `brakeTorque`     | `6000`  | Total service-brake torque, split across both axles    |
| `brakeBias`       | `0.8`   | Fraction of `brakeTorque` sent to the front axle       |
| `handBrakeTorque` | `8000`  | Total handbrake torque, applied to the rear axle only  |

Each axle's share is split evenly between its two wheels, so the defaults give 2400 per front wheel, 600 per rear wheel, and 4000 of handbrake per rear wheel. `brakeBias: 0.5` is a balanced setup; `1` is front-only.

## Queries

Five ways to ask the world a question, none of which move anything or add anything to it.

| Hook | Asks |
| ---- | ---- |
| `useClosestHitRaycaster` · `useAnyHitRaycaster` · `useAllHitsRaycaster` | what does this **ray** hit |
| `useShapeCaster` | what does this **shape** hit, swept along a direction |
| `useShapeOverlap` | what would this shape be **touching**, placed here |
| `usePointQuery` | which body is **at this point** |
| `useBroadphaseQuery` | what is **near** here, by bounding box alone |

Every one of them takes `layer`, `broadPhaseLayer` and `ignoreBodies`, and every one reuses its result objects between calls — copy anything you need to keep. All of them are cheap enough to call every frame; only `useShapeCaster` allocates, and only when it is re-aimed (see below).

### Raycasting

Three hooks, same options and same hit shape, differing only in which hits they keep:

| Hook                      | Returns              | Use it for                                        |
| ------------------------- | -------------------- | ------------------------------------------------- |
| `useClosestHitRaycaster`  | the nearest hit      | picking, ground checks, aiming                    |
| `useAnyHitRaycaster`      | *a* hit, cheapest    | line of sight — "is anything in the way"          |
| `useAllHitsRaycaster`     | every hit, nearest first | shooting through glass, listing what a beam crosses |

```tsx
const [raycaster] = useClosestHitRaycaster();

useFrame(() => {
  const hit = raycaster?.cast(origin, direction);
  if (hit?.hit) console.log(hit.point, hit.normal, hit.bodyID);
});
```

`cast(origin?, direction?)` accepts `Vector3`s or tuples and returns `{ hit, fraction, distance, point, normal, bodyID, subShapeID }`. `subShapeID` names the part of a composite shape that was hit — the triangle of a mesh, the child of a compound — and is what [identifying surfaces](#identifying-surfaces) is looked up by. `fraction` is along the ray; `distance` is `fraction × |direction|`, so the ray's length is meaningful.

`useAllHitsRaycaster` returns an **array** of that shape, sorted nearest-first, and empty on a miss.

Result objects and the array are reused between casts — copy anything you need to keep. Casting allocates nothing, so calling one every frame is fine.

Any-hit stops at the first hit the traversal meets rather than comparing distances, which is why it is the cheapest and why the hit it reports is *not* necessarily the nearest.

Pass `layer` to cast against something other than the moving layer. The default (`LAYER_MOVING`) masks both groups, so it sees static geometry too.

### `useShapeCaster` — sweeping a shape

A ray is a line with no width, so it cannot answer *would this fit through there*. A shape cast can: it sweeps a real collider along a direction and reports what stops it.

```tsx
const [, body] = useCapsule({ height: 1.2, radius: 0.45, position: [0, 1, 0] });

const [caster] = useShapeCaster({
  shape: body?.shape,
  direction: [0, 0, -10],
});

useFrame(() => {
  const hit = caster?.cast(position, rotation);
  if (hit?.hit) console.log(hit.fraction, hit.contactPointOn2);
});
```

`shape` is usually a body's own `api.shape`, which is `undefined` until that body mounts — the caster waits for it and stays `undefined` in the meantime, exactly as a constraint waits for its bodies. It holds a reference to the shape while it lives, so a caster outliving its body is safe rather than a crash.

`cast(position?, rotation?, direction?)` — each argument falls back to the last one used, so a caster that only moves can be called with one. The length of `direction` is how far the sweep reaches.

Re-aiming rebuilds Jolt's `ShapeCast`, which is the one allocation any query here makes — a few percent of the cost of the cast itself, and only when the aim actually changes. It is not avoidable: a `ShapeCast` caches the shape's world bounds when it is built, so one that is nudged in place keeps searching where it used to be and silently finds nothing.

`mode` picks the collector and, with it, the return type:

| `mode` | Returns |
| ------ | ------- |
| `"closest"` (default) | the first thing the sweep meets |
| `"any"` | *a* hit, cheapest — for "is the path blocked" |
| `"all"` | every body along the sweep, nearest first |

A hit carries `fraction`, `distance`, `bodyID`, `subShapeID`, `contactPointOn1` (on your shape), `contactPointOn2` (on the body hit), `penetrationAxis`, `penetrationDepth` and `isBackFaceHit`.

Also: `scale`, `backFaces` (hit the inside of triangles), and `returnDeepestPoint` for a sweep that starts already overlapping.

### `useShapeOverlap` — what is in this region

```tsx
const [probe] = useShapeOverlap({ shape: blastShape, mode: "all" });

const detonate = (at: Vec3Tuple) => {
  for (const hit of probe?.overlap(at) ?? []) damage(hit.bodyID, hit.penetrationDepth);
};
```

Same three modes and the same hit shape minus `fraction`, `distance` and `isBackFaceHit`. Trigger volumes, blast radii, "is this spawn point clear", "select everything in the box" — all of them are this rather than a ray.

`maxSeparationDistance` also reports bodies within that distance of touching. `internalEdgeRemoval` drops the ghost hits a shape gets from the interior edges of a triangle mesh, where two triangles meet and neither is really a wall.

### `usePointQuery` — what is here

```tsx
const [query] = usePointQuery();
const hit = query?.query([x, y, z]);
```

The cheapest question in the library: no shape, no direction, no sweep. It returns `{ hit, bodyID, subShapeID }`, or an array of them in `"all"` mode.

A very short ray is the usual substitute and answers a different question — a ray has to *enter* a body, so one starting inside reports nothing.

### `useBroadphaseQuery` — what is near

```tsx
const [broad] = useBroadphaseQuery();
const nearby = broad?.collideSphere(position, 20); // body ids
```

`castRay` · `collideAABox` · `collideSphere` · `collidePoint` · `collideOrientedBox` · `castAABox`, all returning an array of body ids and nothing else.

This is the acceleration structure alone: **bounding boxes, no shape ever looked at**. Its answer is always a *superset* of the exact one, so it is right for AI perception, spatial culling, and narrowing a set before an exact test — and wrong for anything that has to be true.

Jolt binds no ready-made broadphase collectors, so the library supplies its own and every hit costs one call into JS. That is affordable precisely because the answers are meant to be small; it is not a query to run against the whole world every frame.

### Filtering

| Option | Effect |
| ------ | ------ |
| `layer` | Object layer to query against. Defaults to `LAYER_MOVING`, which masks both groups and so sees static geometry too |
| `broadPhaseLayer` | Skip whole regions of the tree before any shape is looked at. Index into `broadPhaseLayers` on `<Physics>` |
| `ignoreBodies` | Bodies the query pretends are not there |

`ignoreBodies` is also settable at runtime — `api.setIgnoredBodies([body])` — which is usually necessary rather than convenient: the body doing the asking does not exist yet when the query hook mounts, and without it a self-query reports itself at zero distance.

### `overlapsAABox` / `overlapsOrientedBox`

Two plain functions, not hooks — box-against-box with no world involved, for culling and region tests you want answered without asking the simulation anything.

```tsx
const { Jolt } = useJolt();

overlapsAABox(Jolt, { centre, halfExtents, rotation }, { min, max });
```

## Contact events

Jolt allows exactly **one** contact listener per physics system, its callbacks run *inside* the step, and the `Body` / `ContactManifold` pointers are valid only for the duration of the call. Both hooks below hide that.

### `useBodyContacts` — the common case

Filtered to one body, with data copied out of the manifold and **delivery deferred to the next frame**, so calling `setState` in a handler is safe.

```tsx
const [ref, api] = useSphere({ radius: 0.4, position: [0, 5, 0], motionType: "dynamic" });

useBodyContacts(api?.body, {
  onEnter: (contact) => {
    if (contact.userData === HAZARD) api?.kill();
  },
});
```

A `ContactInfo` is `{ bodyID, userData, shapeUserData, point, normal, penetrationDepth, impactSpeed, impulse }` describing **the other** body. It is pooled — copy anything you keep past the handler. On `onExit` only `bodyID` and `userData` are meaningful, because the manifold is already gone.

`normal` points **from your body towards the other one**, so negating it is the direction your body was pushed. Both sides of a contact therefore read a normal that means the same thing to each of them, which Jolt's own does not: its manifold normal runs from body 1 to body 2 in an ordering the subscriber cannot see. `useContactListener` gets that raw manifold unchanged.

#### How hard it hit

`impactSpeed` and `impulse` are `0` unless you ask for them, because the estimate costs about ten calls into WASM per contact per step:

```tsx
useBodyContacts(api?.body, { onEnter: (c) => bang(c.impulse) }, { contactForce: true });
```

`impactSpeed` is the closing speed along the contact normal in m/s, read before the solver ran. `impulse` is that speed times the pair's effective mass, in kg·m/s.

**`impulse` is an estimate.** Jolt binds no applied contact impulse, so it is derived and leaves the angular terms out of the effective mass — within about 10% of the true impulse head-on, about 70% high for a glancing hit. Rank a scrape against a crash with it; do not treat it as the solver's own number.

It is closing *momentum*, so it scales with the mass of what was hit. To threshold across bodies of different sizes, divide that back out: `impulse * body.GetMotionProperties().GetInverseMass()` is the velocity change the blow would have caused, and compares a boulder against a pebble where the raw number does not.

A body that is not dynamic — static *or* kinematic — counts as immovable, which is what Jolt's solver does. A kinematic body reports a real inverse mass through the bindings, so reading that number instead would make the same drop onto a moving platform read softer than onto the ground.

### `useSensor` — what is inside a volume

A body created with `sensor: true` reports contacts and imparts no impulse. `useSensor` gives those contacts their own names and, more usefully, keeps the set of bodies currently inside:

```tsx
const [ref, api] = useBox({ position: [0, 2, 0], size: [4, 4, 4], motionType: "static", sensor: true });

const [inside] = useSensor(api?.body, {
  onIntersectionEnter: (contact) => arm(contact.bodyID),
  onIntersectionExit: (contact) => disarm(contact.bodyID),
});
```

`inside` is a `readonly number[]` of body ids in entry order. Keeping that list by hand from a pair of enter/exit counters looks right and drifts, because a body can leave in two ways that are not moving:

- **It falls asleep.** Jolt only keeps a sensor contact while the other body is awake, so a crate that settles inside a trigger fires an exit one step later without having moved, and an enter again when it wakes. `useSensor` holds that exit back and keeps the body in `inside`; pass `keepSleeping: false` for Jolt's raw behaviour.
- **It is destroyed.** A body killed while asleep inside gets no exit from Jolt at all — its contact went away when it slept. The held exit is delivered instead, so the list still empties.

One case survives either way: if the **sensor** moves off a sleeping body, no exit fires until that body wakes, because Jolt has no contact left to remove. Set `allowSleeping: false` on the bodies you track if that matters.

`useSensor` and `useBodyContacts` can both subscribe to the same body.

### `useContactListener` — raw

Every contact, delivered synchronously inside the step, with arguments already `wrapPointer`ed.

```tsx
useContactListener({
  onContactValidate: (body1, body2) => body1.GetUserData() !== body2.GetUserData(),
  onContactAdded: (body1, body2, manifold, settings) => {
    settings.mCombinedRestitution = 0.9;
  },
});
```

Many components can subscribe; the library multiplexes them onto Jolt's single listener. `onContactValidate` accepts by default and handlers run in registration order — the first `false` rejects the pair.

Inside these handlers: **do not** retain a `Body` or manifold past the call, **do not** call `setState`, and **do not** create or destroy bodies. Use `useBodyContacts` when you need any of that.

### Subscribing a store

`useJolt().contacts` exposes `subscribe(cb) => unsubscribe` and `getSnapshot()`, so you can drive `useSyncExternalStore` or a zustand store from contact activity without the library owning your state.

## `useJolt`

Returns the physics context: `Jolt` (the module), `joltInterface`, `physicsSystem`, `bodyInterface`, `layers`, `groups`, `objectLayer(group, mask)`, `contacts`, `activation`, `constraints`, `steps`, `temps`, `timing`, [`step(delta?)`](#stepping-it-yourself), `debug` and `state`. Use it to reach anything the hooks do not wrap.

## State management

The library holds no store. Transforms are written straight onto `mesh.position` / `mesh.quaternion` inside `useFrame`, never through React state — pushing 60 Hz physics data through state or context re-renders the subtree every frame. Contact events are the exception, and are deferred to a frame boundary so `setState` is safe.

## Debug rendering

Two routes, for two different questions.

### `<PhysicsDebug />` — everything in the world

```tsx
<Physics>
  <PhysicsDebug />
  <YourScene />
</Physics>
```

Walks the world every frame and draws a wireframe for **every** body, including ones you created directly through `useJolt()` — which the per-hook flag cannot see, because it only knows about bodies it built itself. Reach for this when something is colliding and you cannot tell what with.

Coloured by motion type rather than by shape, since it has no hook to ask:

| Motion type | Colour     |
| ----------- | ---------- |
| `static`    | seagreen   |
| `kinematic` | dodgerblue |
| `dynamic`   | violet     |

Override any of them with `<PhysicsDebug colors={{ static: "red" }} />`. The defaults are exported as `debugMotionColors`. Geometry is cached per shape, so a hundred bodies sharing one shape cost one `BufferGeometry` between them, and wireframes interpolate along with the bodies.

It also draws every [constraint](#constraints) as a gold line running body 1's centre → its anchor → body 2's anchor → body 2's centre, all of them sharing one buffer so the whole set is a single draw call. Turn it off with `<PhysicsDebug constraints={false} />`.

Unlike bodies, joints are drawn from the library's own registry: Jolt exposes no way to ask a world what constraints it holds, so a constraint built by hand through `useJolt()` is the one thing here that cannot be drawn.

### Per-hook `debug` — one body

`debug` on a hook (or `<Physics debug>` for all of them) overlays a wireframe of that collider only, coloured by shape kind. Better when you are looking at one thing. Colours come from the exported `debugColors`, so you can match them in your own UI.

| Hook                     | Colour                       |
| ------------------------ | ---------------------------- |
| `useBox`                 | violet                       |
| `useSphere`              | yellow                       |
| `useCapsule`             | blue                         |
| `useCylinder`            | green                        |
| `useTaperedCapsule`      | orange                       |
| `useConvex`              | magenta                      |
| `useCompound`            | crimson                      |
| `useTrimesh`             | hotpink                      |
| `useCharacter`           | black                        |
| `useCar` body / wheels   | lawngreen / mediumslateblue  |

## Migrating from 0.1.x

- **Peers changed.** React 19, R3F 9, and `jolt-physics` is now a peer you install yourself.
- **`useCar` wheel options renamed.** `offsetHorizontal` → `offsetForward`, `offsetVertical` → `offsetDown`.
- **`useCar` braking is no longer tied to `driveType`** and is configurable via `brakeTorque`, `brakeBias` and `handBrakeTorque`. The handbrake is rear-axle only.
- **`useCar().update` returns reused objects.** It used to allocate fresh ones every call.
- **`useClosestHitRaycaster().cast` returns hit data**, not just a collector: `{ hit, fraction, distance, point, normal, bodyID }`. `distance` previously held the fraction.
- **`useCharacter().update` trailing arguments** moved into an options object.
- **`useCharacter({ options })` is optional** and deep-merged with defaults.
- **`useTrimesh` takes a `BufferGeometry`** (the `{ position, index }` form still works).
- **`mass` no longer defaults to `1000`.** Omit it for Jolt's density-derived mass. It is ignored on static bodies, where it previously corrupted the heap.
- **`material.friction: 0` now works.** Falsy values used to be dropped.
- **Every hook returns a `geometry`**, and it is disposed on unmount.
- **`<Physics>` is no longer wrapped in `memo`** and gains `paused`, `debug`, `timeStep`, `maxSubSteps`, `collisionSteps`, `broadPhaseLayers`, `module`, `init` and `settingsOverride`.

## Troubleshooting

**Bodies fall through thin floors.** Fast movers tunnel. Set `motionQuality: "linearCast"` on the moving body, or make the floor thicker than the distance travelled in one step.

**Nothing renders and there are no errors.** `<Physics>` renders `null` until the WASM module resolves. If it never resolves, your bundler is probably not serving the `.wasm` asset — use the default `wasm-compat` entry point.

**`SharedArrayBuffer is not defined`.** You selected a multithreaded build without COOP/COEP headers. See [Choosing a Jolt build](#choosing-a-jolt-build).

**Changing a prop does nothing.** Body props are read once at mount. Change the component's `key` to rebuild.

**A body's visual sits inside the floor.** The mesh and collider disagree. Turn on `debug` — the wireframe is the collider, and geometry whose origin is not at its centre needs the same offset applied to the mesh.

**Contact handlers crash or corrupt memory.** You retained a `Body` or manifold past the handler, or created/destroyed a body inside one. Use `useBodyContacts`, which copies the data out and defers delivery.

**Memory grows over time.** Run against `jolt-physics/debug-wasm-compat`, which asserts on double frees and invalid parameters, and compare `JoltInterface.prototype.sGetFreeMemory()` across mount/unmount cycles.

**A carried body pushes nothing, and drops straight down when released.** You are teleporting it with `setPositionAndRotation` instead of driving it with `moveKinematic`. See [Moving things by hand](#moving-things-by-hand).

**A body driven by `moveKinematic` flies off at a wild speed.** You passed `useFrame`'s delta as `deltaTime`. Omit the argument — it defaults to the physics step, which is a different clock from the render delta.

**A kinematic body passes through the static world.** It was probably given an explicit `group`/`mask` meant for a static body. Kinematic bodies default to the moving group for exactly this reason.

**`setMotionType` warns and does nothing.** The body was created `static` without `allowDynamicOrKinematic: true`, so Jolt never gave it `MotionProperties`. The flag has to be set at creation.

**`setScale` warns about `MakeScaleValid`.** Spheres and capsules can only scale uniformly. Pass equal components, or use a box or hull.

**Meshes look smooth but the wireframes lag.** They should not — both interpolate. If you are positioning your own object from `api.body.GetPosition()`, that is the un-interpolated transform; see [Interpolation](#interpolation).

## Demo

```bash
pnpm install
pnpm dev
```

59 scenes in seven categories, one per hook or feature:

| Category         | Covers                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| **Shapes**       | all 12 shape hooks, one scene each · terrain from all three `heights` forms · per-triangle surface types |
| **Body options** | motion types · mass & material · damping · DOF locks · sensors · sleep/wake · gravity factor · layers & masks · collision groups · auto colliders · motion quality |
| **Control**      | forces & impulses · velocities · teleport vs drive · kinematic platform · grab & scale · conveyor    |
| **Constraints**  | all 8 constraint hooks · motors · springs · rope built from chained distance joints                 |
| **Queries**      | closest hit · any hit · all hits · shape cast · shape overlap + broadphase · point query             |
| **Events**       | `useBodyContacts` · `useContactListener` · `useSensor` · contact force                             |
| **Systems**      | character · car · interpolation · step callbacks · debug rendering · stress test · instancing · manual stepping · breakable objects |

Toolbar toggles for `<PhysicsDebug />`, `paused`, `interpolate`, and a `1/60` · `1/30` · `1/15` · `vary` timestep switch, so the scenes that exist to show a difference can actually show it.

Switching scenes remounts the whole world, which doubles as the mount/unmount stress test.

Each scene lives in `demo/scenes/<category>/<Name>.tsx` and is written to be read — short, one idea each, commented where the behaviour is surprising rather than where the code is obvious.

## License

MIT
