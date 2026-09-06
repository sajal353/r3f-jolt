# Changelog

## 0.3.0

### Breaking changes

- `ContactInfo.normal` now points from the body you subscribed to towards the body in `bodyID`. It was Jolt's manifold normal, which runs body 1 → body 2 in an ordering the subscriber cannot see, so it was backwards on one side of every contact. `useContactListener` is unaffected.

### Constraints

Eight hooks, one per Jolt constraint type. Nothing joint-shaped was buildable before this — no door, chain, lift, rope bridge or ragdoll.

- `useFixedConstraint`, `usePointConstraint`, `useHingeConstraint`, `useSliderConstraint`, `useDistanceConstraint`, `useConeConstraint`, `useSwingTwistConstraint`, `useSixDOFConstraint`. Each takes two bodies and returns `[api]`, `undefined` until both exist.
- Either side may be `null` to anchor to the world. `undefined` means "not created yet", and the joint waits for it.
- Motors on the hinge, slider, swing-twist and six-DOF joints: `position` holds a target and carries load, `velocity` turns at a rate, `off` hands the joint back to the simulation. Both settable at runtime.
- Springs on joint limits (`limitsSpring`) and inside motors, as `{ frequency, damping }` or `{ stiffness, damping }`.
- Shared options: `enabled`, `priority`, `numVelocityStepsOverride`, `numPositionStepsOverride`, `settingsOverride`, `debug`.
- Every runtime setter wakes both bodies — a sleeping body ignores a retargeted motor. `api.activate()` for the cases the library cannot see.
- `<PhysicsDebug constraints>` draws joints, on by default. Jolt cannot enumerate a world's constraints, so only hook-created ones are drawn.
- `useFixedConstraint` returns a `TwoBodyConstraint`: Jolt binds `FixedConstraintSettings` but no matching class. A weld has no runtime controls, so nothing is lost.
- A rope wants `numPositionStepsOverride` per joint rather than a raised world-wide solver setting — a chain is solved a link at a time.

### Queries

Four hooks beyond raycasts. None of them move anything or add anything to the world.

- `useShapeCaster` sweeps a real collider along a direction. A ray is a line with no width, so "would this fit through there" could not be asked before.
- `useShapeOverlap` reports what a shape would touch, placed somewhere. `maxSeparationDistance` widens it to bodies near touching; `internalEdgeRemoval` drops the ghost hits from a triangle mesh's interior edges.
- `usePointQuery` — which body contains this point. A very short ray answers a different question: a ray has to *enter* a body, so one starting inside reports nothing.
- `useBroadphaseQuery` — `castRay`, `collideAABox`, `collideSphere`, `collidePoint`, `collideOrientedBox`, `castAABox`, returning body ids only. Bounding boxes, so always a superset of the exact answer, and each hit costs one call into JS.
- The three narrow-phase hooks take `mode: "closest" | "any" | "all"`, which picks the collector and the return type together.
- `ignoreBodies` and `broadPhaseLayer` on every query including the raycasters, plus `setIgnoredBodies` at runtime. Without it a self-query reports itself at zero distance.
- `overlapsAABox` and `overlapsOrientedBox` as plain functions — box against box, no world involved.
- A query holds a reference to the shape it was given, so it is safe to outlive the body that shape came from.

### Shapes

- `usePlane` — the ground as a collider rather than a very wide box. **Jolt's plane is not infinite**: it is a half space bounded by `halfExtent`, defaulted to 100 here against Jolt's 1000, with `renderSize` sizing the mesh separately. Takes a `normal` and `constant`, or a `point` it passes through.
- `useHeightField` — terrain at a fraction of a triangle mesh's cost. `heights` takes an `(x, z) => number | null` sampler, a row-major `number[]` / `Float32Array`, or greyscale image data; a `null` or `NaN` sample is a hole. Api: `getMinHeight`, `getMaxHeight`, `getHeight`, `isNoCollision`, `getHeights`, `setHeights`.
- `setHeights` quantises into the range the field was **built** with and works in whole blocks, so deformable terrain reserves headroom through `range` up front and a misaligned region is refused.
- `useTaperedCylinder` — a cylinder with two radii, and a cone with one at zero. Flat ends are the difference from `useTaperedCapsule`: this stands where that rolls.
- `useEmpty` — a body with no collision at all. It moves, sleeps and can be jointed to, but never touches anything. The anchor for a one-sided constraint that has to move.
- `scale` at creation on every body hook, seeding the same slot `api.setScale` uses, so a later `setScale` replaces it rather than compounding.
- `massProperties: { mass?, inertia? }` and `overrideMassProperties`, for a body whose shape does not describe how it should behave. Both survive a `setScale`. Jolt has no centre-of-mass override — that comes from the shape.
- `buildQuality` and `triangleUserData` on `useTrimesh`, read back with `api.getTriangleUserData(hit.subShapeID)` — surface types for footstep audio or per-surface tyre grip.
- `subShapeID` on `RaycastHit`, which the shape-cast and overlap results already carried.
- `setMaterial` and `getMaterial` on `usePlane` and `useConvex`, the only two classes that bind it. `PhysicsMaterial` carries no friction, restitution or name; it is an identity token.

### Contacts and filtering

- `impactSpeed` and `impulse` on `ContactInfo`, opt in per subscriber with `useBodyContacts(body, handlers, { contactForce: true })`. Without it both stay `0` and nothing is computed.
- **`impulse` is an estimate.** Jolt binds no applied contact impulse, so it is derived and leaves the angular terms out of the effective mass — within about 10% of the true impulse head-on, about 70% high for a glancing hit. It is momentum, so it scales with the mass of what was hit: divide the inverse mass back out to threshold across bodies of different sizes.
- `useSensor` — intersection events for a `sensor: true` body, plus the set of bodies currently inside it. Jolt keeps a sensor contact only while the other body is awake, so a body settling inside would otherwise report a spurious exit; that is handled.
- `collisionGroup` on every body hook, `useGroupFilterTable` to build the filter, `api.setCollisionGroup` to change it later. Layers decide what a body *is*; group filters decide which individuals ignore each other. Different groups always collide; the same group consults the table. This is the ragdoll self-collision mechanism.
- `interactionGroups(group, mask)` — the object-layer packing as a plain function, for places that take a raw layer without a `useJolt()` call. Throws past 16 bits rather than dropping the high half.
- A kinematic body reports a real inverse mass while the solver treats it as immovable, so the effective mass keys on `IsDynamic()` — a crate landing on a moving platform reads the same as one landing on the ground.
- The `impulse` estimate is no longer computed for a kind of event nobody subscribed to.

### Ergonomics

- `useAutoCollider` — the collider is read off the mesh the ref is attached to, so a size is written once, in the JSX. `"box"` and `"sphere"` from the geometry's bounds, `"hull"` from its points, `"trimesh"` from its triangles. The mesh's own `scale` is applied, and geometry not centred on its origin gets a `RotatedTranslatedShape`.
- `useInstancedBodies` — many bodies of one kind on one `InstancedMesh`: one shared shape, one batched add, and a write-back that skips whatever Jolt has put to sleep. `collider` takes a descriptor for any of the ten collider kinds, or a factory. `at(index)` is a documented subset of `BodyApi`.
- Batch add and remove — `AddBodiesPrepare` / `AddBodiesFinalize` / `AddBodiesAbort` / `RemoveBodies`, so a swarm walks the broadphase once instead of once per body. `AddBodiesPrepare` sorts the id array in place.
- `updateLoop: "independent"` and `api.step(delta?)` take the world off R3F's frame loop and advance it by hand, running the same accumulator, step callbacks and event flushes a frame does.
- `frameloop="demand"` now works. `<Physics>` asks for the next frame while any body is awake and stops once they have all slept.
- `updatePriority` replaces the hard-coded `-1`, with a warning if set positive: R3F hands rendering to the subscriber above zero, and the result is a black canvas.
- One shape builder for every collider hook, so a collider means the same thing whichever way it is asked for.

### Step callbacks

- `useBeforePhysicsStep(callback)` and `useAfterPhysicsStep(callback)` run once per physics **step**, which is not once per frame. A force applied from `useFrame` lands at the wrong strength by an amount that depends on the viewer's refresh rate — which is why buoyancy, thrusters and custom gravity fields need these.
- Both receive `(delta, index)`: the step's own duration and its number.
- They run **between** steps rather than inside one, so the world is safe to touch. The one rule is not to `setState` from them.
- Subscribers run in mount order, and one subscribed from inside a step waits for the next. Unsubscribing is exact under `<StrictMode>`.

### World configuration

- `maxBodies`, `maxBodyPairs`, `maxContactConstraints` and `maxWorkerThreads` on `<Physics>`. Jolt sizes these at construction, so they are read once at mount and a new value needs a new world (`key`). Applied before `settingsOverride`, which still wins.
- A world that runs out of bodies now throws a message naming `maxBodies` instead of trapping in wasm.
- `physicsSettings` — the solver and sleep settings, applied over the world's own defaults and live. Raising `numVelocitySteps` / `numPositionSteps` stiffens everything at once; the per-constraint overrides are cheaper for one stretchy rope.
- `maxWorkerThreads` still needs a `…-multithread` build and COOP/COEP headers, and is still not the default.
- `<Physics debug>` is read by each hook at mount, so changing it rebuilds every body in the world. `<PhysicsDebug />` is the live toggle.

### Conveyor belts

- `useConveyor(api, options)` turns a body's surface into a belt: whatever rests on it is dragged along while the body stays put. `linear` for walkways and belts, `angular` for turntables, with `setLinear`, `setAngular` and `stop` for changing one while it runs.
- `surfaceVelocity` on the body hooks declares the same thing at mount.
- `space: "local"` (the default) rotates the velocity by the belt's own rotation, so an angled belt carries along itself.
- `wake`, on by default, starts the bodies resting on a belt when it begins moving — a sleeping body reports no contacts at all.
- A `useCharacter` is not carried: Jolt's character contact settings have no surface-velocity field.

### Demo

59 scenes. New in 0.3.0:

- **Constraints** — one scene per hook, plus Motors and Springs.
- **Queries** — Shape cast, Shape overlap, Point query.
- **Shapes** — Plane, Height field, Terrain sources, Tapered cylinder, Empty, Surface types.
- **Events** — Sensor volumes, Contact force.
- **Body options** — Collision groups, Auto colliders.
- **Systems** — Step callbacks, Manual stepping, Breakable objects. Instancing is rewritten onto `useInstancedBodies`, the same 1050 bodies in seven draw calls.
- `<PhysicsDebug />` starts off in every scene, and the toolbar is its one control.

### Fixes

- Contact `onExit` no longer reports `userData: 0` for a body whose partner's listener had just unmounted.


## 0.2.1

Everything Jolt already supported that the hooks had not yet reached, plus manual control over a body. **Purely additive** — no existing signature changed.

### Kinematic bodies

- **`motionType: "kinematic"`.** Bodies you move yourself that still push dynamic bodies out of the way — moving platforms, lifts, doors, carried objects.
- **`api.moveKinematic(position, rotation, deltaTime?)`** is the correct way to drive one. `setPositionAndRotation` teleports with zero velocity, so a platform moved that way carries nothing standing on it.
- `deltaTime` defaults to the world's step duration. Passing `useFrame`'s render delta instead is a mistake that _compounds_ rather than merely scaling: the body overshoots, the next correction is computed from the overshot position, and the drive runs away.

### Imperative body api

`applyForce` · `applyTorque` · `applyForceAndTorque` · `applyImpulse` · `applyAngularImpulse` · `setLinearVelocity` · `setAngularVelocity` · `setVelocities` · `setPositionAndRotation` · `setMotionType` · `setLayer` · `setGravityFactor` · `sleep` · `wake` · `isSleeping` · `setEnabled` · `resetSleepTimer`

- Jolt spells the force family `Add*`; these are named `apply*` and map one-to-one onto it.
- All of them take a three `Vector3`/`Quaternion` or a tuple, and convert into pooled Jolt temporaries — **no allocation per call**, so they are safe in a `useFrame`.
- All of them no-op once the body is killed or the world is disposed.
- `setMotionType` **refuses** to promote a static body created without `allowDynamicOrKinematic` and warns instead. Jolt asserts on this in a debug build; a release build corrupts memory quietly.

### Picking things up

- **`api.grab()` / `moveTo()` / `release()` / `isGrabbed()`.** `grab` switches to kinematic remembering what the body was, `release` restores it. The throw is free: the velocity the carry accumulated is already on the body, so `release` applies no impulse of its own.
- **`api.setScale(scale, updateMassProperties?)`.** Jolt shapes are immutable, so this swaps the collider for a `ScaledShape`. Always rebuilt from the base shape, so repeated calls replace rather than compound. Non-uniform scale is refused on spheres and capsules with a warning naming Jolt's suggested valid scale. An explicit `mass` survives the swap, which it does not through a raw `SetShape`.
- The library owns no input: these are the calls an XR controller, a pointer or a gamepad would drive. New `Grab` demo scene.

### New body options

`allowDynamicOrKinematic` · `sensor` · `linearDamping` · `angularDamping` · `gravityFactor` · `allowSleeping` · `initialAngularVelocity` · `allowedDOFs` (plus `lockRotations` / `lockTranslations` / `enabledRotations` / `enabledTranslations`) · `enhancedInternalEdgeRemoval` · `applyGyroscopicForce` · `collideKinematicVsNonDynamic` · `maxLinearVelocity` · `maxAngularVelocity` · `numVelocityStepsOverride` · `numPositionStepsOverride`

DOF locks are **world**-space, not local-space — Jolt changed this in 0.18.0 to match other engines.

### Sleep and wake events

- `onWake` / `onSleep` on every body hook, plus `api.isSleeping()`.
- Delivered after the step rather than from inside it, where touching the world is unsafe — the same deferral contact events use. The listener is only installed while some body asks for it.

### Raycasting

- **`useAnyHitRaycaster`** — stops at the first hit found rather than comparing distances. The cheapest of the three; the hit it reports is not necessarily the nearest.
- **`useAllHitsRaycaster`** — every body along the ray, sorted nearest-first.
- All three now share one internal implementation of the filter set and the reset-then-cast discipline, and return the same hit shape.

### Interpolation

- **`<Physics interpolate>`, on by default.** Bodies render between physics steps instead of snapping to the last one, which is what stops a fixed timestep juddering when the frame rate is not a multiple of it. Costs one step of latency; pass `interpolate={false}` to opt out.
- Forced off for `timeStep="vary"`, which already lands one step per frame. Static bodies are never interpolated, and a teleport snaps instead of sliding in from the old position.

### `<PhysicsDebug />`

- Draws a wireframe for **every** body in the world, including ones created directly through `useJolt()` — which the per-hook `debug` flag cannot see, since it only knows about bodies it built itself.
- Coloured by motion type (`debugMotionColors`, overridable via `colors`), geometry cached per shape so bodies sharing a shape share one `BufferGeometry`.
- The per-hook `debug` flag still works and is still the better choice for looking at one body.

### Fixes

- **`useCharacter`'s `enableStickToFloor` did the opposite of its name.** Jolt switches the feature off by zeroing `ExtendedUpdateSettings.mStickToFloorStepDown`, and the hook zeroed it when the option was `true`, restoring Jolt's default of `(0, -0.5, 0)` when it was `false`. A character walking downhill launched off the surface every step instead of being held against it, and one standing on a moving platform slid off it. Walking a character down a 25° ramp, the fix takes the frames spent off the ground from 97 in 100 to 4.
- **`useCompound` no longer crashes on an invalid child.** A dimension was only checked for being _present_, so `radius: -1` reached Jolt, `Create()` failed, and the failed `ShapeResult` was dereferenced. Children are now checked for a positive finite number and skipped with a console error, as documented.
- **A failed `ShapeResult` is never dereferenced.** Every shape built through settings — compound, convex, tapered capsule, trimesh, character, car — reads its result through one guard that raises a JS error carrying Jolt's own reason. A release build previously corrupted memory here instead of asserting.
- **A box's `convexRadius` is now visible in debug.** Jolt's triangulation reports the sharp box whatever the radius, so the debug mesh gets purpose-built geometry for the real rounded collider. The `geometry` the hook returns is unchanged: it is still a plain `BoxGeometry`, and the debug version is built lazily, only when `debug` is on.
- **Debug wireframes draw as an overlay** (`depthTest: false` and a high render order). A collider that sits _inside_ the mesh drawn for it — which is exactly what a rounded box is — was hidden by the very thing it describes.

`<PhysicsDebug />` still draws boxes sharp: `BoxShape` binds `GetHalfExtent()` but no `GetConvexRadius()`, so only the hook that created the body knows the radius.

### Internal

- `JoltApi` gained `timing` (`stepDelta`, `stepCount`, `alpha`, `interpolate`), `activation`, and `temps` — a shared pool of Jolt temporaries that keeps the imperative api allocation-free.
- `BodyApi.shape` is now documented as the **base** shape the hook owns. After a `setScale` the body runs on a `ScaledShape` wrapping it, so it is no longer the body's own shape. The hook holds its reference for the body's lifetime instead of handing sole ownership to Jolt, because every rescale rebuilds from it.

## 0.2.0

A correctness and compatibility release. Everything below is a breaking change, a bug fix, or both.

### Requirements

- **React 19 / R3F 9.** R3F 8 cannot run on React 19, so the peer range moved to `react >=19 <19.3` and `@react-three/fiber ^9`.
- **`jolt-physics` is now a peer dependency** at `^1.1.0`, not a bundled dependency. It was previously a hard dependency, which meant an app pinning its own copy shipped two WASM builds.
- **`three >=0.156`.** `@react-three/drei` is no longer a peer — the library never imported it.

### Crashes and memory corruption

- **Static bodies with a `mass` prop corrupted the heap.** `GetMotionProperties()` returns a null pointer for a static body, and every hook called `SetInverseMass(1 / mass)` on it unconditionally. Since `mass` defaulted to `1000`, this fired for _every_ static body. Mass is now applied only to dynamic bodies, via `ScaleToMass`, which scales the inertia tensor too.
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
- **Collision groups and masks** — `group`, `mask` and `layer` on every body hook, plus `broadPhaseLayers` on `<Physics>`. Two bodies collide when each one's group appears in the other's mask. Note that group and mask are 16 bits each.
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
