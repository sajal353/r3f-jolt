# Changelog

## 0.3.0

### Ergonomics

Geometry was declared twice and drifted, a swarm of bodies had to be written by hand, and the frame loop was not yours.

- **`useAutoCollider`** — the collider is read off the mesh the ref is attached to, so a size is written once, in the JSX, instead of once there and once in the hook. `"box"` and `"sphere"` come from the geometry's bounds, `"hull"` from its points, `"trimesh"` from its triangles. The mesh's own `scale` is applied rather than ignored, a sphere under a non-uniform scale says which number it used, and geometry that is not centred on its origin gets a `RotatedTranslatedShape` — otherwise a mesh modelled with its feet at zero collides half a body below itself, which looks like a physics bug and is not one.
- **`useInstancedBodies`** — many bodies of one kind on one `InstancedMesh`: one shared Jolt shape, one `BodyCreationSettings` rewound per body, one batched add, one loop writing instance matrices that skips whatever Jolt has put to sleep. `collider` takes a descriptor for any of the ten collider kinds, or a factory for anything they do not cover. The api carries the bodies and `at(index)`, a deliberate subset of `BodyApi` — an instance has no mesh and no shape of its own, so the parts about either are absent rather than lying.
- **Batch add and remove** — `AddBodiesPrepare` / `AddBodiesFinalize` / `AddBodiesAbort` / `RemoveBodies`, so a swarm walks the broadphase once instead of once per body. Measured, because Jolt's own examples do not use this path: **`AddBodiesPrepare` sorts the array it is handed**, so a hook keeping index → body must keep its own list, and `BodyInterface_AddState` is **not** ours to destroy — `destroy` on one throws and leaving it alone leaks nothing.
- **`updateLoop: "independent"` and `api.step(delta?)`** — takes the world off R3F's frame loop and advances it by hand, running exactly what a frame runs: the same accumulator, the same step callbacks, the same event flushes. `step()` with no argument is one `timeStep`.
- **`frameloop="demand"` now works.** `<Physics>` asks R3F for the next frame while any body is awake and stops asking once they have all slept, so a world no longer freezes mid-fall on demand — and genuinely stops rendering once it settles.
- **`updatePriority`** replaces the hard-coded `-1`, with a warning if it is set positive: R3F hands rendering to the subscriber as soon as any frame priority is above zero, and the result is a black canvas rather than an error.
- One shape builder rather than two: the seven primitive hooks, `useConvex`, `useCompound` and `useTrimesh` now build their colliders through the same descriptor path `useInstancedBodies` takes, so a collider means the same thing whichever way it is asked for.
- Demo: **Instancing** rewritten onto the hook — the same 1050 bodies in seven draw calls, with the shape building, the batch add, the write-back and the teardown gone from the scene. Plus **Auto colliders** and **Manual stepping**. 56 → 58 scenes.

### Contacts and filtering

A contact reported that it happened and nothing about how hard, sensors were counted by hand, and two bodies of the same kind could not be made to ignore each other.

- **Contact force on `ContactInfo`** — `impactSpeed`, the closing speed along the contact normal, and `impulse`, that speed times the pair's effective mass. Opt in per subscriber with `useBodyContacts(body, handlers, { contactForce: true })`; without it both stay `0` and nothing is computed, so existing subscribers pay nothing. **`impulse` is an estimate**: Jolt binds no applied contact impulse anywhere, and the library says so in the jsdoc, the README and the demo caption rather than implying it was measured. It leaves the angular terms out of the effective mass, which reads high for a glancing blow on a long lever.
- **`useSensor`** — intersection events for a `sensor: true` body, plus the set of bodies currently inside it. That set is the reason it exists: a body can leave a trigger volume in two ways that are not moving. Jolt keeps a sensor contact only while the other body is **awake**, so a crate that settles inside fires an exit one step later without having moved; and a body destroyed while asleep inside gets no exit at all, because its contact went away when it slept. Both are handled, and the one case that survives — a sensor moving off a sleeping body — is documented with its fix.
- **`collisionGroup` on every body hook**, plus **`useGroupFilterTable`** to build the filter and `api.setCollisionGroup` to change it later. This is the layer `group`/`mask` pair's opposite number: layers decide what a body *is*, group filters decide which *individuals* ignore each other. Two bodies in different groups always collide; two in the same group consult the table. It is the ragdoll self-collision mechanism, where adjacent bones overlap by design.
- **`interactionGroups(group, mask)`** — the object-layer packing as a plain function, for the places that take a raw layer without a `useJolt()` call. It throws past 16 bits rather than dropping the high half quietly, which the README could previously only warn about in prose.
- Measured rather than read, because two of these would have shipped as defects: every `Body` vector getter hands back the **same** wrapper over shared static storage, so reading body 2's velocity overwrites body 1's — written straight, the relative velocity at a contact is exactly zero every time. And a **kinematic** body reports a real inverse mass, 0.000125 for an 8000 kg slab, while the solver treats it as immovable — so the effective mass keys on `IsDynamic()` and not on the number, or a crate landing on a moving platform reads softer than one landing on the ground.
- Three demo scenes: **Sensor volumes** (a trigger reporting what is in it, whose count holds after the balls fall asleep inside), **Contact force** (four weights dropped onto sprung platforms — they land at the same speed and the sink follows the impulse, 0.22 to 1.53 across the four), and **Collision groups** (two jointed chains of overlapping links, one filtered — the unfiltered one hangs a third longer because every link shoves the ones it is joined to).

### Shapes

Four colliders Jolt supports were unreachable, and the most common static collider of all — a ground plane — had to be faked with a very wide box.

- **`usePlane`** — the ground, as a collider rather than a 100×0.01×100 slab. **Jolt's plane is not infinite**: it is a half space bounded by `halfExtent`, whose Jolt default of 1000 paints a two-kilometre wireframe quad over every scene with `<PhysicsDebug />` on. The hook defaults it to 100 and sizes the render mesh separately with `renderSize`, so the gap between the collider and what you can see is a choice rather than a surprise. Give it a `normal` and a `constant`, or a `point` it passes through.
- **`useHeightField`** — terrain at a fraction of a triangle mesh's cost. `heights` takes a `(x, z) => number | null` sampler, a row-major `number[]` / `Float32Array`, or greyscale image data so a heightmap PNG drops straight in; all three index the same way and a `null` or `NaN` sample is a hole nothing collides with. The api adds `getMinHeight` / `getMaxHeight` / `getHeight`, `isNoCollision`, and `getHeights` / `setHeights` — the primitive craters are built on, with the render geometry re-triangulated in place so the mesh and the collider cannot drift.
- **`useTaperedCylinder`** — a cylinder with two radii, and with one at zero, a cone. Flat ends are the whole difference from `useTaperedCapsule`: this stands where a tapered capsule rolls.
- **`useEmpty`** — a body with no collision at all. It moves, sleeps, carries velocity and can be jointed to; it simply never touches anything. A one-sided constraint bolts to the world and cannot move, so this is the anchor for when it has to.
- **`scale` at creation on every body hook.** It wraps the collider in the same `ScaledShape` `api.setScale` builds later, seeding one slot rather than two — so a later `setScale` replaces it instead of compounding with it, and both go through the same validity check.
- **Full mass properties** — `massProperties: { mass?, inertia? }` plus `overrideMassProperties`, for a body whose shape does not describe how it should behave: a hollow shell, a weighted die, a flywheel. Both survive a `setScale`, which would otherwise recompute them from density × the new volume. Jolt has **no** centre-of-mass override — that comes from the shape.
- **`buildQuality` and `triangleUserData` on `useTrimesh`.** The tag is read back through `api.getTriangleUserData(hit.subShapeID)`, which is how a collision reports a surface type for footstep audio or per-surface tyre grip.
- **`subShapeID` on `RaycastHit`**, which the shape-cast and overlap results already carried. Without it there is nothing to look a triangle up by.
- **`setMaterial` / `getMaterial` on `usePlane` and `useConvex`** — the only two classes that bind it. `PhysicsMaterial` carries a refcount and nothing else, no friction or restitution or name, so it is an identity token rather than a surface description; the README says so rather than letting anyone find out.
- Measured rather than read, because it changed the code: `PlaneShapeSettings`'s `inHalfExtent` constructor argument is dropped by the bindings when no material is passed, and only the field takes. `ShapeResult.Get()` never downcasts, so a plane from it has no `GetHalfExtent` and a heightfield no `IsNoCollision` — everything subclass-shaped goes through `castObject`. `setHeights` quantises into the range the field was **built** with and clamps silently, so deformable terrain has to reserve headroom through `range` up front. And `getHeights` / `setHeights` work in whole blocks: a misaligned region asserts in a debug build and reads past the end of the heap in a release one, so the hook refuses instead.
- Six demo scenes: **Plane** (balls roll off the visible floor and keep rolling), **Height field** (a noise generator with a hole punched through it, and `setHeights` raising a mound), **Terrain sources** (the three `heights` forms side by side, with a car to drive over them), **Tapered cylinder**, **Empty**, and **Surface types**.

### Queries

Raycasts were the only question the library could ask the world. Four more hooks, none of which move anything or add anything to the world.

- **`useShapeCaster`** sweeps a real collider along a direction. A ray is a line with no width, so *would this fit through there* was not a question that could be asked before this.
- **`useShapeOverlap`** reports what a shape would be touching, placed somewhere — trigger volumes, blast radii, "is this spawn point clear". `maxSeparationDistance` widens it to bodies near touching, and `internalEdgeRemoval` drops the ghost hits a shape gets from the interior edges of a triangle mesh.
- **`usePointQuery`** — which body contains this point. The usual substitute, a very short ray, answers a different question: a ray has to *enter* a body, so one starting inside reports nothing.
- **`useBroadphaseQuery`** — `castRay` / `collideAABox` / `collideSphere` / `collidePoint` / `collideOrientedBox` / `castAABox`, returning body ids and nothing else. Bounding boxes only, no shape ever looked at, so the answer is always a superset of the exact one. Jolt binds no ready-made broadphase collectors, so the library supplies its own and every hit costs one call into JS — affordable precisely because the answers are meant to be small.
- All three narrow-phase hooks take `mode: "closest" | "any" | "all"`, which picks the collector and the return type together. This differs from the raycasters, which are three hooks; those cannot change.
- **`ignoreBodies` and `broadPhaseLayer` on every query, raycasters included**, plus `setIgnoredBodies` at runtime. The second is usually necessary rather than convenient: the body doing the asking does not exist yet when the query hook mounts, and without it a self-query reports itself at zero distance.
- **`overlapsAABox` / `overlapsOrientedBox`** as plain functions rather than hooks — box against box, no world involved.
- A shape handed to a query is usually a body's own `api.shape`, which is `undefined` until that body mounts. The query waits for it, and holds a reference to it while it lives, so a query outliving its body is safe rather than a crash.
- Three demo scenes: **Shape cast** (the same capsule swept at a gate it fits and one it does not), **Shape overlap** (a region highlighting what it contains, with the broadphase's answer drawn over the exact one), and **Point query**.

### Step callbacks

- **`useBeforePhysicsStep(callback)`** and **`useAfterPhysicsStep(callback)`** run once per physics step, which is not once per frame: a fixed timestep runs however many steps that frame's delta paid for. A force applied from a `useFrame` is therefore applied at the wrong strength, and by how much depends on the viewer's refresh rate — which is why buoyancy, thrusters and custom gravity fields need these.
- Both receive `(delta, index)` — the step's own duration and its number.
- They run **between** Jolt's steps rather than inside one, so unlike Jolt's own `PhysicsStepListener` there is no lock held and the world is safe to touch. The one rule is not to `setState` from them: that schedules a render per sub-step, from inside the step loop.
- Subscribers run in mount order, and one subscribed from inside a step is held until the next step rather than run twice in the same one. Unsubscribing is exact under `<StrictMode>`, which mounts every effect twice — a step callback subscribed there fires once per step, not twice.
- New **Step callbacks** demo scene: two rings in orbit under the same pull, one taking it per step and one per frame, each with the circle it should be tracing drawn through it. The per-frame ring leaves its circle. Switch the toolbar to `vary`, where one frame is one step, and both hold it.

### World configuration

- **`maxBodies` / `maxBodyPairs` / `maxContactConstraints` / `maxWorkerThreads`** on `<Physics>`. Jolt sizes these at construction, so they are read once at mount and a new value needs a new world (`key`). They are applied before `settingsOverride`, which still wins.
- **A world that runs out of bodies now says so.** Jolt returns a null body when the pool is full and everything after that dereferences it; the cap is checked before the first allocation, so the failure is a sentence naming `maxBodies` rather than a wasm trap.
- **`physicsSettings`** — the solver and sleep settings, applied over the defaults the world was built with, so an option you do not name keeps Jolt's default rather than becoming zero. Unlike the caps this one is live. Raising `numVelocitySteps` / `numPositionSteps` stiffens everything at once; the per-constraint overrides are the cheaper tool for one stretchy rope.
- `maxWorkerThreads` replaces reaching into `settingsOverride` for it. Multithreading still needs a `…-multithread` build and COOP/COEP headers, and is still not the default.
- **Documented, not fixed:** `<Physics debug>` is read by each hook at mount, so changing it rebuilds every body in the world. `<PhysicsDebug />` is the live toggle.

### Constraints

Eight new hooks, one per Jolt constraint type — the largest gap in the library until now. Nothing joint-shaped was buildable before: no door, chain, lift, rope bridge or ragdoll.

- **`useFixedConstraint`** · **`usePointConstraint`** · **`useHingeConstraint`** · **`useSliderConstraint`** · **`useDistanceConstraint`** · **`useConeConstraint`** · **`useSwingTwistConstraint`** · **`useSixDOFConstraint`**. Each takes two bodies and returns `[api]`, `undefined` until both bodies exist.
- **Either side may be `null`**, which anchors to the world — a door in a frame that is not a body, a chain hanging from nothing. `undefined` means "that body is not created yet" and the joint waits for it, so a body hook's first-render `undefined` can be passed straight through.
- **Motors** on the hinge, slider, swing-twist and six-DOF joints: `position` holds a target and carries load, `velocity` turns at a rate, `off` hands the joint back to the simulation. Targets and state are settable at runtime.
- **Springs** on joint limits (`limitsSpring`) and inside motors, as either `{ frequency, damping }` or `{ stiffness, damping }`.
- **Every runtime setter wakes both bodies.** A settled joint puts its bodies to sleep, and a sleeping body ignores a retargeted motor — the same trap `useConveyor`'s `wake` option exists for. `api.activate()` is exposed for the cases the library cannot see.
- Shared across all eight: `enabled`, `priority`, solver step overrides, `settingsOverride`, and `debug`, which draws the joint as body 1's centre → its anchor → body 2's anchor → body 2's centre. The middle segment has zero length while the constraint holds, so a visible line there is the solver losing.
- **`<PhysicsDebug />` draws joints too**, via `constraints` (on by default). Jolt exposes no way to enumerate a world's constraints, so the library keeps its own registry of the ones its hooks create — which does mean a constraint built by hand through `useJolt()` is not drawn, unlike a hand-built body. Every joint shares one line buffer, so a world full of them is still a single draw call.
- `useFixedConstraint` returns a `TwoBodyConstraint` — Jolt binds `FixedConstraintSettings` but no matching class. A weld has no runtime controls, so nothing is lost.
- **Ten demo scenes**, one per hook plus **Motors** and **Springs**. `<PhysicsDebug />` now starts *off* in every scene and the toolbar is the one control for it — the scenes no longer set the per-hook `debug` flag, which draws unconditionally and is deliberately independent of the world-wide overlay.
- The **Distance** scene builds a rope out of the hook: one joint with equal min and max is a rigid rod, eleven short ones in series are a rope, and the two hang side by side from the same anchor. Rope needs `numPositionStepsOverride` / `numVelocityStepsOverride` per joint — a chain is solved a link at a time, so a correction at one end needs a pass per link to reach the other, and asking per joint beats raising the world-wide solver settings.
- The **Motors** scene walks its position-motor targets over at a fixed rate rather than setting the far end in one go. A position motor takes a setpoint, not a speed, so it closes the gap as fast as its force limit allows — which is why a lift dropped faster than it rose and a target set on a limit overshot straight through it.

### Conveyor belts

- **`useConveyor(api, options)`** turns a body's surface into a belt: whatever rests on it is dragged along while the body itself stays put. `linear` for walkways and belts, `angular` for turntables, and `setLinear` / `setAngular` / `stop` on the returned api for changing a belt while it runs.
- **`surfaceVelocity` on the body hooks** declares the same thing at mount, for a belt whose speed never changes. Both routes share one record per body.
- `space: "local"` (the default) rotates the velocity by the belt's own rotation, so a belt laid at an angle carries along itself rather than along world axes.
- `wake` — on by default — starts the bodies resting on a belt when it begins moving. Without it a crate that had gone to sleep on a stopped belt would never notice, because a sleeping body reports no contacts at all.
- A `useCharacter` is **not** carried: Jolt's character contact settings have no surface-velocity field.

### Fixes

- Contact `onExit` no longer reports `userData: 0` for a body whose partner's listener had just unmounted. The cleanup cleared the remembered-userData entry under the listener's own id, but that map is keyed by the *other* body in a contact. The map is now bounded instead of pruned under the wrong key.

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
