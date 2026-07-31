# Changelog

## 0.2.0

A correctness and compatibility release. Everything below is a breaking change, a bug fix, or both.

### Requirements

- **React 19 / R3F 9.** R3F 8 cannot run on React 19, so the peer range moved to `react >=19 <19.3` and `@react-three/fiber ^9`.
- **`jolt-physics` is now a peer dependency** at `^1.1.0`, not a bundled dependency. It was previously a hard dependency, which meant an app pinning its own copy shipped two WASM builds.
- **`three >=0.156`.** `@react-three/drei` is no longer a peer — the library never imported it.

### Crashes and memory corruption

- **Static bodies with a `mass` prop corrupted the heap.** `GetMotionProperties()` returns a null pointer for a static body, and every hook called `SetInverseMass(1 / mass)` on it unconditionally. Since `mass` defaulted to `1000`, this fired for *every* static body. Mass is now applied only to dynamic bodies, via `ScaleToMass`, which scales the inertia tensor too.
- **Invalid `useCompound` children passed a null pointer into WASM.** Validation failures `break` out of the `switch` and then reached `AddShape(..., undefined, 0)`. Invalid children are now skipped with a console error and the rest of the compound still builds.
- **Unmount order caused a use-after-free.** React runs a parent's cleanup before its children's, so `<Physics>` destroyed the `JoltInterface` while body hooks were still about to call `RemoveBody`. `<Physics>` now flags the world as disposed synchronously and defers the destroy to a microtask, so the whole commit — children included — tears down against a live world.
- **`useCharacter` was entirely broken on jolt-physics 1.1.** `CharacterContactListenerJS` gained new callbacks, and the Emscripten binding rejects a partially implemented interface. All eleven are now provided.
- **Shapes built from `ShapeSettings` could be freed while still in use.** `Shape` is reference counted and `settings.Create().Get()` hands back a shape owned by the settings object; destroying the settings released it. Shapes now take an explicit reference that is released once `BodyCreationSettings` holds its own.
- **`useCar` never cleaned up.** The body was never removed, the step listener was never detached, and the constraint leaked. Teardown is now ordered: remove and destroy the step listener, remove the constraint and release it (`AddConstraint` takes the only reference, so `RemoveConstraint` already deletes it and a following `destroy` was a double free), then remove and destroy the body.

### Fixed behaviour

- **`useCharacter` sank through the floor when crouching.** Both capsules were built with the standing shape's vertical offset, so the crouching collider sat too high and the character settled below the ground by the difference — 0.45 units for a 1.8/0.9 character.
- **`useCar` applied the rear wheels' brake settings to the front-right wheel** — a copy-paste bug that left the rear wheels unconfigured.
- **`useCar` braking is no longer tied to `driveType`.** The service brake acts on all four wheels with a configurable front bias (`brakeTorque`, `brakeBias`, default `0.8`), and the handbrake acts on the rear axle only (`handBrakeTorque`).
- **`useCar`'s reverse-blocking logic was dead code.** `previousForward` started at `0` and was only assigned inside a branch that could never be entered.
- **`useClosestHitRaycaster` reset its collector after reading it**, so a second cast reused stale state. It now resets before each cast and returns extracted hit data — `{ hit, fraction, distance, point, normal, bodyID }` — instead of a raw collector. `distance` is now a real distance (`fraction × |direction|`); it previously held the fraction.
- **`material.friction: 0` and `restitution: 0` were dropped** by falsy checks.
- **`useCharacter().update` mutated the `direction` vector you passed in.** Callers reusing a vector across frames had it corrupted.
- **`useCharacter` swapped its collision shape on every update**, filters and all, whether or not the crouch state changed.
- **The `gravity` prop was read once at init**, with no way to change it. It is now live.
- **`useCar`'s `"ray"` collision tester was unreachable.** `castType` is now `"cylinder" | "sphere" | "ray"`.
- **Debug meshes for `useCharacter` stayed at the origin** until `update()` was called; they now sync every frame.
- **`useCar` wheel options renamed** to match their axes: `offsetHorizontal` → `offsetForward` (+Z), `offsetVertical` → `offsetDown` (−Y).

### Memory leaks

Measured with `JoltInterface.prototype.sGetFreeMemory()` across mount/unmount cycles; every hook now reports **zero** drift.

- `<Physics>` created two `JoltInterface`s under StrictMode and leaked the first — the entire physics world, temp allocator included.
- The gravity `Vec3`, and every position/rotation/velocity temporary handed to `BodyCreationSettings`, were never destroyed.
- `useTrimesh` allocated one `Float3` per vertex and one `IndexedTriangle` per triangle and leaked them all — tens of thousands of WASM allocations per mount on a detailed mesh. Both are now reused; the `PhysicsMaterial` and the settings objects are freed.
- `useConvex` leaked one `Vec3` per hull point.
- `useTaperedCapsule` never destroyed its shape settings.
- `useCar` leaked two `Vec3` per wheel per frame — eight per frame for a four-wheel car — into `GetWheelLocalTransform`.
- `useCharacter` leaked its update settings, all four collision filters, the character settings, a `Plane`, both shape settings and the contact listener on every unmount.
- The generated `geometry` was built unconditionally but only disposed when `debug: true`, so it leaked on every unmount with debug off.
- Per-frame three.js allocations across all hooks (two `Vector3` and two `Quaternion` per body per frame) are gone; transforms now write into existing objects.

### New

- **Contact events.** `useBodyContacts(body, { onEnter, onStay, onExit })` filters by body, copies data out of the manifold while it is valid, and defers delivery to a frame boundary so `setState` is safe. `useContactListener(handlers)` gives raw in-step access. Jolt permits one contact listener per system; the library multiplexes many subscribers onto it. `useJolt().contacts` exposes `subscribe`/`getSnapshot` for `useSyncExternalStore` or an external store.
- **Collision groups and masks** — `group`, `mask` and `layer` on every body hook, plus `broadPhaseLayers` on `<Physics>`, mapping onto rapier's `interactionGroups` and cannon's filter pair. Note that group and mask are 16 bits each.
- **Swappable Jolt build** — `<Physics module={…}>` or `<Physics init={…}>` selects the WASM, multithreaded, asm or debug build. This is what makes `jolt-physics` being a peer dependency coherent.
- **`<Physics>` props**: `paused`, `debug` (a default for every child hook), `timeStep` (fixed-step accumulator, default `1/60`) with `maxSubSteps` and `collisionSteps`, and `settingsOverride` for `mMaxBodies` / `mMaxWorkerThreads` / assertion handlers.
- **Body options**: `enabled`, `userData`, `shapeUserData`, `motionQuality`, and `convexRadius` where the shape supports it.
- **`api.kill()` / `api.revive()`** remove and re-add a body without unmounting.
- **Every hook returns a `geometry`** matching its collider, disposed on unmount.
- **`useTrimesh` accepts a `BufferGeometry`** directly and derives the index when the geometry is non-indexed.
- **`useCharacter`** takes an optional, deep-merged `options`, exposes `maxSlopeAngle`, `maxStrength`, `characterPadding`, `penetrationRecoverySpeed` and `predictiveContactDistance`, supports a non-vertical `up`, and takes its `update` extras as an options object.

### Internals

- The eight shape hooks shared ~90% duplicated code, so every bug existed five to eight times. They now go through one `useBody` with shared shape-to-geometry, transform-sync and debug-material helpers.
- `<Physics>` steps at `useFrame` priority `-1`, ahead of every body's sync. Negative priority does not trigger R3F's manual-render takeover; only positive does.
- The WASM module is cached per initialiser, so several `<Physics>` trees instantiate it once.
- Full type exports, an `exports` map with a `types` condition, `sideEffects: false`, and `files` so the tarball ships only `dist/`.
- Build artefacts are no longer committed.

### Tooling

- Vite 8, TypeScript 5.9, ESLint 10 flat config, Vitest 4, pnpm.
- Split tsconfigs, so a demo type error no longer blocks the library build.
- A test suite that runs against `jolt-physics/debug-wasm-compat` with a throwing assertion handler — it caught two ownership bugs that the release build accepted silently.
- The demo moved out of the published source tree into `demo/`, with scenes for shapes, character, car, raycasting and contacts, and a scene switcher that stresses mount/unmount.
