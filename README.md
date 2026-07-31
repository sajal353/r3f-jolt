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

### `<Physics>` renders nothing until the WASM module resolves

Loading Jolt is asynchronous. `<Physics>` returns `null` until the module is ready, so its children never mount early and no hook inside it runs against a missing world. It does not suspend, so it needs no `<Suspense>` boundary — but anything of yours that *does* suspend (`useGLTF`) still needs its own.

### Stepping happens before syncing

`<Physics>` steps the world on `useFrame` with priority `-1`, which runs ahead of every body's transform sync at the default priority, so meshes always show post-step transforms. The priority stays negative on purpose: R3F hands rendering over to a subscriber only when priority is greater than zero.

### Fixed timestep

The world advances in fixed `timeStep` increments (default `1/60`) drawn from an accumulator, so simulation is independent of frame rate. At most `maxSubSteps` (default `4`) steps run per frame; beyond that the accumulator is dropped rather than spiralling. Pass `timeStep="vary"` for frame-delta stepping.

### Units

Jolt is tuned for metres, kilograms and seconds. A 1-unit cube weighing 20 is a sensible crate. Very small or very large shapes need solver tuning; prefer scaling your world to metres.

## `<Physics>`

| Prop                | Default           | Notes                                             |
| ------------------- | ----------------- | ------------------------------------------------- |
| `gravity`           | `[0, -9.81, 0]`   | Live — changing it calls `SetGravity`             |
| `paused`            | `false`           | Stops stepping; bodies stay alive                 |
| `debug`             | `false`           | Default for every child hook's `debug`            |
| `timeStep`          | `1/60`            | Or `"vary"` for frame-delta stepping              |
| `maxSubSteps`       | `4`               | Fixed steps allowed per frame                     |
| `collisionSteps`    | `1`               | Collision sub-steps passed to `Step`              |
| `broadPhaseLayers`  | static + moving   | See [Collision groups](#collision-groups-and-masks) |
| `module`            | —                 | An already-initialised Jolt module                |
| `init`              | `wasm-compat`     | A custom module initialiser                       |
| `settingsOverride`  | —                 | `(settings, jolt) => void`, for `mMaxBodies` etc. |

## Collision groups and masks

Jolt object layers are built from a **group** and a **mask**, which map directly onto rapier's `interactionGroups` and cannon's `collisionFilterGroup` / `collisionFilterMask`.

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

> **Group and mask are 16 bits each**, not 32 — the object layer packs them as `(mask << 16) | group`, so you get 16 collision groups. Porting a 32-bit rapier `interactionGroups` value will silently lose the high half.

Broad-phase layers are configured on `<Physics>`, one entry per layer:

```tsx
<Physics broadPhaseLayers={[{ include: STATIC }, { include: PLAYER | ENEMY }]} />
```

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

Many static hosts do not set these, and without them the multithreaded build will not start. Cap worker threads with `settingsOverride`:

```tsx
<Physics settingsOverride={(settings) => (settings.mMaxWorkerThreads = 2)} />
```

Modules are cached per initialiser, so mounting several `<Physics>` trees instantiates the WASM once.

## Body hooks

`useBox` · `useSphere` · `useCapsule` · `useCylinder` · `useTaperedCapsule` · `useConvex` · `useCompound` · `useTrimesh`

All of them take these options and return `[ref, api]`.

### Shared options

| Option                     | Default                     | Notes                                              |
| -------------------------- | --------------------------- | -------------------------------------------------- |
| `position`                 | —                           | `[x, y, z]`                                        |
| `rotation`                 | `[0, 0, 0, 1]`              | Quaternion                                         |
| `motionType`               | —                           | `"static"` or `"dynamic"`                          |
| `mass`                     | Jolt's density-derived mass | Dynamic bodies only; ignored on static ones        |
| `material`                 | —                           | `{ friction?, restitution? }`; `0` is respected    |
| `initialVelocity`          | —                           | `[x, y, z]`, applied at creation                   |
| `debug`                    | `<Physics debug>`           | Wireframe of the real collider                     |
| `enabled`                  | `true`                      | `false` creates the body without adding it         |
| `userData`                 | —                           | 32-bit uint, readable in contact handlers          |
| `shapeUserData`            | —                           | 32-bit uint, set on the shape                      |
| `motionQuality`            | `"discrete"`                | `"linearCast"` for fast movers                     |
| `group` / `mask` / `layer` | static/moving split         | See [Collision groups](#collision-groups-and-masks) |
| `bodySettingsOverride`     | —                           | `(settings) => void` before the body is created    |

`userData` is **32-bit** — Jolt narrowed it from 64-bit because WebIDL could not marshal 64-bit integers. Larger ids truncate; the library warns in development.

### Shape-specific options

| Hook                | Options                                          |
| ------------------- | ------------------------------------------------ |
| `useBox`            | `size: [x, y, z]`, `convexRadius?`               |
| `useSphere`         | `radius`, `segments?`                            |
| `useCapsule`        | `height`, `radius`, `segments?`                  |
| `useCylinder`       | `height`, `radius`, `convexRadius?`, `segments?` |
| `useTaperedCapsule` | `topRadius`, `bottomRadius`, `height`            |
| `useConvex`         | `vertices: number[][]`                           |
| `useCompound`       | `shapes: CompoundChild[]`                        |
| `useTrimesh`        | `mesh: BufferGeometry \| { position, index? }`   |

`convexRadius` defaults to a value derived from the shape's size rather than a fixed `0.05`, which was wrong on small shapes.

`useTrimesh` accepts a `BufferGeometry` directly and derives the index when the geometry is non-indexed. **A trimesh body is always static** — Jolt mesh shapes cannot be dynamic.

`useCompound` children are `{ type, position, rotation?, … }` where `type` is `box`, `sphere`, `capsule`, `cylinder`, `taperedCapsule` or `convex`. An invalid child is skipped with a console error and the rest of the compound still builds.

### Returned api

| Field       | Notes                                                     |
| ----------- | --------------------------------------------------------- |
| `body`      | `Jolt.Body`                                               |
| `shape`     | The created shape                                         |
| `geometry`  | A `BufferGeometry` matching the collider, disposed on unmount |
| `debugMesh` | The wireframe mesh, or `null`                             |
| `kill()`    | Removes the body from the simulation without unmounting   |
| `revive()`  | Adds it back                                              |

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

## `useClosestHitRaycaster`

```tsx
const [raycaster] = useClosestHitRaycaster();

useFrame(() => {
  const hit = raycaster?.cast(origin, direction);
  if (hit?.hit) console.log(hit.point, hit.normal, hit.bodyID);
});
```

`cast(origin?, direction?)` accepts `Vector3`s or tuples and returns `{ hit, fraction, distance, point, normal, bodyID }`. `fraction` is along the ray; `distance` is `fraction × |direction|`, so the ray's length is meaningful. The result object is reused between casts.

Pass `layer` to cast against something other than the moving layer.

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

A `ContactInfo` is `{ bodyID, userData, shapeUserData, point, normal, penetrationDepth }` describing **the other** body. It is pooled — copy anything you keep past the handler. On `onExit` only `bodyID` and `userData` are meaningful, because the manifold is already gone.

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

Returns the physics context: `Jolt` (the module), `joltInterface`, `physicsSystem`, `bodyInterface`, `layers`, `groups`, `objectLayer(group, mask)`, `contacts`, `debug` and `state`. Use it to reach anything the hooks do not wrap.

## State management

The library holds no store. Transforms are written straight onto `mesh.position` / `mesh.quaternion` inside `useFrame`, never through React state — pushing 60 Hz physics data through state or context re-renders the subtree every frame, which is the single biggest performance mistake in a React physics integration. Contact events are the exception, and they are deferred to a frame boundary so `setState` is safe.

## Debug colours

`debug` overlays a wireframe of the real collider. Colours come from the exported `debugColors`, so you can match them in your own UI.

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

## Demo

```bash
pnpm install
pnpm dev
```

Scenes for shapes, character, car, raycasting and contacts, with `debug` and `paused` toggles. Switching scenes remounts the whole world, which doubles as the mount/unmount stress test.

## License

MIT
