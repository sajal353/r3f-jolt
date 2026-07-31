# r3f-jolt — roadmap

Where this library is going, and why. Jolt Physics exposes far more than `r3f-jolt` currently surfaces; this document tracks what is scheduled, in what order, and what forces that order.

---

## Release train

| Release   | Contents                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.2.0** | React 19 / R3F 9 / jolt-physics 1.1, a large batch of bug, leak and lifecycle fixes, contact events, reworked demo, rewritten docs, first tests                                                                                                                               |
| **0.2.1** | Feature parity with `@react-three/rapier` and `@react-three/cannon` where Jolt already supports it — kinematic bodies, sensors, damping, DOF locks, sleep control, any/all raycasts, an imperative force/impulse api, interpolation, a global debug renderer. Purely additive |
| **0.3.0** | Foundations — constraints + motors, instancing, auto-colliders, shape/point queries, before/after-step hooks                                                                                                                                                                  |
| **0.4.0** | Character & water systems — ragdolls (active + passive), skinned-model binding, water volumes with flow, soft bodies & cloth                                                                                                                                                  |
| **0.5.0** | Advanced vehicles, destruction & dynamic worlds, determinism / save-load / netcode                                                                                                                                                                                            |
| **0.6.0** | Hair, rope and cables via Cosserat rods                                                                                                                                                                                                                                       |

### Why this order

- `Ragdoll` is built on `TwoBodyConstraint`, and active ragdolls need `MotorSettings`, so **0.3.0's constraint work is a hard prerequisite** for 0.4.0.
- Cloth ships with the character work rather than alongside vehicles: `SoftBodyMotionProperties.SkinVertices()` consumes the _same_ `SkeletonPose.GetJointMatrices()` array the ragdoll↔`SkinnedMesh` bridge produces. One piece of plumbing serves both, so a cape on a character is nearly free once ragdolls land.
- Water needs the per-sub-step callback (`useBeforePhysicsStep`) that arrives in 0.3.0. Buoyancy applied per _frame_ rather than per sub-step makes objects bob visibly differently at 30 fps than at 120.
- Vehicles, destruction and determinism share no machinery with the character pipeline, so they sequence cleanly afterwards.
- Hair and rope (0.6.0) are Cosserat rods, which live on the _same_ `SoftBodySharedSettings` structure as cloth — a different constraint topology on the same primitive rather than a new subsystem. They therefore need 0.4.0's soft-body sync and skeleton bridge already in place.

---

## 0.3.0 — Foundations

### Constraints — the single biggest functional gap

Both competitors ship 6–7 joint hooks. r3f-jolt has **none**, though Jolt supports Fixed, Point, Hinge, Slider, Distance, Cone, SwingTwist, SixDOF, Path, Pulley, Gear and RackAndPinion. No ragdoll, door, chain or lift is buildable today.

- [ ] `useFixedConstraint`
- [ ] `usePointConstraint`
- [ ] `useHingeConstraint`
- [ ] `useSliderConstraint`
- [ ] `useDistanceConstraint`
- [ ] `useConeConstraint` / `useSwingTwistConstraint`
- [ ] `useSixDOFConstraint`
- [ ] Shared constraint lifecycle helper — `AddConstraint`/`RemoveConstraint` + destroy, `disposed`-aware. The pre-0.2.0 `useCar` never removed its constraint or step listener on unmount; that is exactly this class of mistake, so it gets solved once, centrally

### Required by 0.4.0 and 0.5.0 — prerequisites, not nice-to-haves

- [ ] `MotorSettings` + `SetMotorState` / `SetTargetAngle` / `SetTargetVelocity` on the applicable constraints — required for active ragdolls, doors, cranes and turrets
- [ ] `SpringSettings` on constraints — shared by ragdoll joints, motorcycle lean and suspension
- [ ] Constraint priority (`CalculateConstraintPriorities`) exposed on the constraint lifecycle helper
- [ ] `useBeforePhysicsStep` / `useAfterPhysicsStep` — water buoyancy must run per sub-step, not per frame

### Queries and events

- [ ] Shape casting (`CastShape`) with closest / any / all collectors — `CastShapeClosestHitCollisionCollector`, `…AnyHit…`, `…AllHit…`
- [ ] Shape overlap (`CollideShape`) with closest / any / all collectors — the same three variants exist
- [ ] Point queries (`CollidePoint`)
- [ ] `useBroadphaseQuery` → `BroadPhaseQuery.CastRay` / `CollideAABox` / `CollideSphere` / `CollidePoint` / `CollideOrientedBox` / `CastAABox` — cheap "what might be near me" tests for AI perception and spatial culling, with no narrow-phase cost
- [ ] `CollideShapeWithInternalEdgeRemoval` as an option on shape overlap — avoids ghost hits against dense triangle meshes
- [ ] `SpecifiedBroadPhaseLayerFilter` alongside the default filters, for querying one specific broadphase layer
- [ ] `OrientedBox.OverlapsAABox` / `OverlapsOrientedBox` exposed as cheap CPU-side overlap helpers
- [ ] Sensor/intersection events (`onIntersectionEnter`/`Exit`) building on 0.2.1's `sensor`
- [ ] Contact force payload (`totalForceMagnitude`, `maxForceDirection`) from the manifold, as rapier's `onContactForce`

### Shapes

- [ ] `usePlane` → `PlaneShapeSettings(plane, material?, halfExtent?)` — an infinite ground plane, the most common static collider there is. Cannon ships `usePlane`; we have no equivalent
- [ ] Heightfield hook → `HeightFieldShapeSettings` (both competitors have one)
- [ ] Tapered-cylinder hook → `TaperedCylinderShapeSettings` (upstream's name; also how you get a cone)
- [ ] `EmptyShape` → `EmptyShapeSettings` — a body with no collision, for markers and attachment points
- [ ] Shape `scale` support at creation → `ScaledShapeSettings` (runtime `api.setScale` ships earlier, in 0.2.1)
- [ ] Full mass properties (density, centre of mass, inertia tensor) via `mMassPropertiesOverride` — today only a scalar `mass`
- [ ] `MeshShapeSettings.mBuildQuality` — trade mesh build time against runtime query speed, which matters when streaming terrain
- [ ] Per-triangle user data on `MeshShape` — how you get surface types out of a collision, for footstep audio and per-surface tire grip
- [ ] Heightfield extras: `GetMinHeightValue` / `GetMaxHeightValue`, `Get/SetMaterials` for per-cell surface types
- [ ] `Shape.SetMaterial` / `PlaneShape.SetMaterial`

### Ergonomics

- [ ] Auto-collider generation from a wrapped mesh — rapier's headline feature. Today geometry args must be duplicated between hook and JSX (`size: [100, 0.01, 100]` _and_ `<boxGeometry args={[100, 0.01, 100]} />`)
- [ ] Instanced bodies (rapier `InstancedRigidBodies`, cannon `api.at(index)`)
- [ ] Batch body add/remove — `AddBodiesPrepare` / `AddBodiesFinalize` / `AddBodiesAbort` / `RemoveBodies`. The supported way to spawn or despawn many bodies at once; adding them one at a time re-walks the broadphase each time. Instanced bodies should be built on this rather than looping `AddBody`
- [ ] Per-body collision filtering via `mCollisionGroup` + a rapier-style `interactionGroups()` helper, layered on 0.2.0's configurable object layers
- [ ] `updatePriority` prop (the `-1` step priority is hard-coded in 0.2.0)
- [ ] `updateLoop: "follow" | "independent"`, manual stepping, `frameloop="demand"` support

### World configuration

- [ ] `maxBodies` / `maxBodyPairs` / `maxContactConstraints` on `Physics` — `JoltSettings` defaults are hard-coded, so consumers hit a body cap they cannot raise
- [ ] Solver settings passthrough (`PhysicsSettings`), as rapier exposes `numSolverIterations` et al.
- [ ] Multithreaded simulation guidance — the entry point is already selectable via 0.2.0's injected `module` prop, so what remains is `JoltSettings.mMaxWorkerThreads` plumbing plus honest docs on the COOP/COEP headers it requires (cannon offloads to a worker instead; we stay main-thread by default)
- [ ] Typedoc API site + hosted examples (both competitors have both)

---

## 0.4.0 — Character & water systems

**Agreed scope:** active + passive ragdolls · auto-fit skeleton binding with per-bone overrides · water volumes with flow · soft bodies & cloth.

### Skeleton bridge — `internal/skeleton.ts`

The shared foundation for ragdolls _and_ skinned cloth. Its own module because both consume it.

- [ ] Build a `Jolt.Skeleton` from a three.js `SkinnedMesh` bone hierarchy via `AddJoint(new Jolt.JPHString(name, len), parentIndex)`
- [ ] Topologically sort bones parent-before-child — `Skeleton.AreJointsCorrectlyOrdered()` requires it and three.js `skeleton.bones` order is not guaranteed. Assert with it after building, or ragdolls break on some rigs and not others
- [ ] Call `CalculateParentJointIndices()`
- [ ] Maintain a stable bone-name → joint-index map, exposed for overrides and debugging
- [ ] Derive a **low-detail ragdoll skeleton** from a bone subset — production ragdolls use ~15 bodies for a 100+ bone rig. Fewer bodies is both faster and more stable, and twist/IK/helper bones must never become bodies
- [ ] Two-way mapper between the full animation skeleton and the ragdoll skeleton. Upstream C++ has `SkeletonMapper`; **it is not bound in JS**, so this is ours to write
- [ ] Map both directions every frame: animation → ragdoll to drive it, ragdoll → animation to render the simulated result on the full-detail rig
- [ ] `PhysicsSystem.SetSimShapeFilter` — lets one body carry a cheap simulation shape and a detailed query shape, filtering collisions between sub-shapes of the same body. Same problem the low-detail ragdoll solves, so design the two together rather than having them fight
- [ ] `SkeletalAnimation.SetIsLooping` / `IsLooping` for the driving animation
- [ ] `SkeletonPose` setup: `SetSkeleton`, `SetRootOffset`, per-joint `GetJoint(i)` → `SkeletalAnimationJointState` write of translation + rotation, then `CalculateJointMatrices()`
- [ ] **Jolt pose → three.js bones**: `GetJointMatrices()` yields _model-space_ `Mat44`; three.js bones need local matrices. Convert by composing with the parent's inverse, accounting for `skeleton.boneInverses` (bind pose). **This is the riskiest code in the phase** — get it subtly wrong and characters look _almost_ right, the worst failure mode. Unit-test the round-trip against a known rig before building anything on it
- [ ] **three.js bones → Jolt pose** (for `DriveToPoseUsingMotors`): read animated bone world matrices into joint states, then `CalculateJointStates()`
- [ ] Allocation-free: `Mat44MemRef` heap views + reusable scratch `Matrix4`/`Quaternion`; this runs every frame per ragdoll
- [ ] Handle non-uniform bone scale, and warn rather than silently producing wrong colliders

### `useRagdoll` — passive + active

- [ ] Build `RagdollSettings`: `mSkeleton`, `mParts` (`ArrayRagdollPart`: a `BodyCreationSettings` + constraint settings per bone), `mAdditionalConstraints`
- [ ] Call the required setup **in order**: `Stabilize()`, `DisableParentChildCollisions()`, `CalculateBodyIndexToConstraintIndex()`, `CalculateConstraintIndexToBodyIdxPair()`, `CalculateConstraintPriorities()` — skipping any of these produces a jittering or exploding ragdoll
- [ ] `CreateRagdoll(collisionGroup, userData, physicsSystem)` → `Ragdoll`
- [ ] Self-collision control via `GroupFilterTable(numGroups)` + `DisableCollision(sub1, sub2)` for adjacent bones, and a `CollisionGroup(filter, groupID, subGroupID)` per part
- [ ] Lifecycle through the 0.3.0 shared constraint/body helper: `AddToPhysicsSystem` on mount, `RemoveFromPhysicsSystem` + destroy on unmount, `disposed`-aware. A ragdoll is one body **and** one constraint per ragdoll part, so the `useCar` leak class costs dozens of leaked objects per instance here rather than a handful
- [ ] Mode `"passive"` — free simulation; drive the `SkinnedMesh` from `GetPose()`
- [ ] Mode `"hardKeying"` — kinematic bodies via `DriveToPoseUsingKinematics(pose, deltaTime)`: animation wins, physics only reacts to the environment. Cheapest and most stable
- [ ] Mode `"softKeying"` — velocities set on **dynamic** bodies to chase the target pose, so the ragdoll can be pushed off its animation (hard keying cannot be)
- [ ] Mode `"motors"` — `DriveToPoseUsingMotors(prevPose, pose, deltaTime)`: true active ragdoll for hit reactions
- [ ] Partial ragdoll: per-bone `dynamic | kinematic` so an arm goes limp while the body keeps animating
- [ ] Blend back to animation (get-up): capture the ragdoll pose, crossfade toward the animation pose over N frames, then hand control back
- [ ] `ResetWarmStart()` after teleporting or a pose snap
- [ ] api: `applyImpulse`, `setLinearVelocity` / `setLinearAndAngularVelocity`, `getRootTransform`, `bodies`, `constraints`, `bounds` (`GetWorldSpaceBounds`), `activate`, `isActive`
- [ ] Debug view of ragdoll bodies + constraint frames, hooked into `<PhysicsDebug />`

### `useCharacterModel` — auto-fit binding with per-bone overrides

- [ ] Cluster skinned vertices per bone from the `skinIndex`/`skinWeight` attributes (weight-thresholded)
- [ ] Fit a capsule per bone in bone-local space from that point cloud: radius from a distance percentile (not the max — outliers ruin it), half-height from the extent along the bone→child axis
- [ ] Box or convex fit as an opt-in alternative for hands, feet and hips
- [ ] Mass distribution from anthropometric ratios keyed off bone-name heuristics, total normalized to a `mass` prop
- [ ] Default joint limits per bone class using `SwingTwistConstraintSettings` — shoulders/hips wide cone, elbows/knees narrow with near-zero twist, spine limited
- [ ] Overrides API: `{ [boneName]: { shape, mass, constraint, exclude } }`
- [ ] Exclude non-physical bones (twist/IK/helper) by default via name patterns; log what was excluded
- [ ] Use `boneInverses` so fitting happens in bind pose, not whatever pose the mesh currently holds
- [ ] Debug overlay of the fitted colliders on the mesh — the primary tuning tool, so build it early
- [ ] Escape hatch: dump the generated config as JSON so a rig can be tuned once and committed

### Character upgrades

- [ ] **Inner rigid body** — `mInnerBodyShape` / `SetInnerBodyShape` / `GetInnerBodyID`. `CharacterVirtual` has no body in the simulation, so today other bodies pass straight through it. An inner body fixes that, and is the answer to the most common complaint about virtual characters
- [ ] `mInnerBodyIDOverride` — pin the inner body's ID, which exists specifically to keep client/server simulations deterministic
- [ ] `mEnhancedInternalEdgeRemoval` on the character — stops the character catching on internal edges of triangle-mesh terrain
- [ ] Compound shapes as the character shape (jolt 0.37.0), not just a capsule — for non-humanoid or asymmetric characters
- [ ] `CharacterID` exposed, so a character stays identifiable after removal and character-vs-character collisions resolve deterministically
- [ ] `HasCollidedWith` / `HasCollidedWithCharacter` / `GetActiveContacts` on the returned api
- [ ] Full `CharacterContactListener` callback set — the current hook wires only `OnAdjustBodyVelocity`, `OnContactValidate`, `OnContactAdded` and `OnContactSolve`; jolt 0.32.0 added `OnContactPersisted`, `OnContactRemoved` and the four `OnCharacterContact*` variants

### Character-vs-character collision

- [ ] `CharacterVsCharacterCollisionSimple` registry on `Physics`; `Add`/`Remove` as `useCharacter` instances mount and unmount, so characters stop walking through each other (multiplayer / crowds)
- [ ] `SetCharacterVsCharacterCollision` wired in `useCharacter`

### Water volumes with flow

Verified: `Body.ApplyBuoyancyImpulse` and `BodyInterface.ApplyBuoyancyImpulse(bodyID, surfacePosition, surfaceNormal, buoyancy, linearDrag, angularDrag, fluidVelocity, gravity, deltaTime)`.

- [ ] `<WaterVolume>` region component: AABox or box shape, with `surfaceLevel`, `buoyancy`, `linearDrag`, `angularDrag`, `flow: Vector3`
- [ ] Apply from `useBeforePhysicsStep` — **per sub-step, not per frame**; applied per frame, floating objects visibly bob differently at 30 fps than at 120
- [ ] Find submerged bodies with a broadphase query per region (`BroadPhaseQuery.CollideAABox` / `CollectTransformedShapes`), never by iterating every body in the world
- [ ] Pooled Jolt temporaries throughout: this runs for every floating body every sub-step and is the single worst place for a per-frame WASM leak
- [ ] Per-body opt-out and per-body buoyancy multiplier (`floats?: boolean | number`)
- [ ] `onEnterWater` / `onExitWater` events for splash VFX and audio, deferred to the frame boundary
- [ ] Swimming mode for `useCharacter`: switch gravity handling and clamp vertical velocity when submerged, implemented through the existing `overrideUpdate` hook rather than forking the update loop
- [ ] Overlapping regions resolve deterministically (highest priority, or deepest surface — pick one and document it)

### Soft bodies & cloth

- [ ] `useSoftBody` from a `BufferGeometry`: vertices → `SoftBodySharedSettingsVertex`, faces → `AddFace`, then `CreateConstraints(vertexAttributes, len, bendType, angleTolerance)` and `Optimize()`
- [ ] Expose `mNumIterations`, `mLinearDamping`, `mPressure` (inflatables), `mFriction`, `mRestitution`, `mGravityFactor` — all on `SoftBodyCreationSettings`
- [ ] `mVertexRadius` — note it lives on `SoftBodyCreationSettings`, **not** `SoftBodySharedSettings`; it moved in jolt 0.37.0. Avoids z-fighting between cloth and the geometry it rests on
- [ ] `mFacesDoubleSided` — renders and collides cloth faces from both sides, which is what a flag needs
- [ ] Pinned vertices via `mInvMass = 0` for flags, banners and curtains
- [ ] `CalculateVolumeConstraintVolumes()` for closed volumes
- [ ] LRA / tether constraints for cloth (`mLRAType` = `EuclideanDistance` | `GeodesicDistance`, `mLRAMaxDistanceMultiplier`) — the standard fix for a cape stretching when the wearer sprints. `CreateConstraints` can auto-generate them
- [ ] Note for the 0.2.1 imperative api: `AddForce` on a soft body applies to the **whole body** as of jolt 0.31.0, not per vertex as it did before
- [ ] **Skinned cloth on a character**: `mSkinnedConstraints` + `SoftBodyMotionProperties.SkinVertices(rootTransform, jointMatrices, numJoints, hardSkinAll, tempAllocator)`, fed the _same_ joint matrices the skeleton bridge produces. This is the cape-on-a-character path, and it is nearly free once that bridge exists
- [ ] `SetEnableSkinConstraints` / `SetSkinnedMaxDistanceMultiplier` for how far cloth may leave the skinned shape
- [ ] Ray and shape casts against soft bodies via `SoftBodyShape`, so cloth is hittable rather than invisible to queries
- [ ] Render sync: read `SoftBodyMotionProperties.GetVertices()` into a `BufferAttribute` each frame via a heap view + `needsUpdate` — allocation-free, and recompute normals only on request (not cheap)
- [ ] `SoftBodyContactListenerJS` for cloth contact events, multiplexed like the rigid contact listener
- [ ] Document the cost honestly: soft bodies are the most expensive thing in Jolt. Give vertex-count guidance

### Verification

- [ ] Unit test the skeleton bridge round-trip: three.js bones → `SkeletonPose` → back to bones reproduces the original pose within epsilon
- [ ] Test `AreJointsCorrectlyOrdered()` passes for a bone hierarchy deliberately supplied out of order
- [ ] Test a ragdoll mount/unmount cycle returns `GetNumBodies()` **and** constraint count to baseline, `sGetFreeMemory` flat over N cycles
- [ ] Test ragdoll self-collision: adjacent bones do not push each other apart at rest
- [ ] Test buoyancy runs per sub-step (a body bobs identically at a 30 Hz and a 120 Hz fixed step)
- [ ] Test water enter/exit events fire once per crossing, not per frame
- [ ] Test soft-body vertex readback allocates nothing across N frames
- [ ] Demo: ragdoll scene with a real glTF character — passive flop, hit reaction via motors, get-up blend
- [ ] Demo: auto-fit collider debug overlay on that character
- [ ] Demo: pool with a current, floating crates, swimming character
- [ ] Demo: cape skinned to the character (shares the skeleton bridge's joint matrices)

---

## 0.5.0 — Vehicles, destruction, determinism

### Advanced vehicles

- [ ] Extract a shared vehicle core from `useCar` (constraint + step listener + collision tester + teardown) so all three vehicle types share one correct lifecycle
- [ ] `useTank` — `TrackedVehicleControllerSettings`, `WheelSettingsTV`, `VehicleTrackSettings` with left/right tracks and `mDrivenWheel`
- [ ] `useMotorcycle` — `MotorcycleControllerSettings` including lean angle and lean spring
- [ ] Drivetrain telemetry for audio and UI: `VehicleEngine.GetCurrentRPM()`, `VehicleTransmission.GetCurrentGear()` / `GetCurrentRatio()` / `GetClutchFriction()` — engine pitch, shift SFX, tachometer
- [ ] Engine torque curve via `LinearCurve` on `VehicleEngineSettings`
- [ ] Surface-dependent grip through `WheeledVehicleControllerCallbacksJS` + `TireMaxImpulseCallbackResult` (tarmac / gravel / ice)
- [ ] `VehicleConstraintCallbacksJS` for slip combining

### Destruction & dynamic worlds

- [ ] `useMutableCompound` — `MutableCompoundShape.AddShape` / `RemoveShape` / `ModifyShape` / `ModifyShapes` at runtime plus `AdjustCenterOfMass()`: the breakable-crate primitive
- [ ] Deformable terrain — `HeightFieldShape.SetHeights(x, y, sx, sy, heights, stride, tempAllocator)` for craters and digging, `GetHeights` for readback, with matching three.js geometry updates
- [ ] Rails and platforms — `PathConstraint` + `PathConstraintPathHermite.AddPoint(position, tangent, normal)` for elevators, moving platforms and coasters; `PathConstraintPathJS` for procedural paths; `SetIsLooping`
- [ ] Machinery — `GearConstraint`, `RackAndPinionConstraint`, `PulleyConstraint`
- [ ] Motorised constraints — doors, cranes, turrets, drawbridges via `MotorSettings` + `SetMotorState`
- [ ] Trigger volumes built on 0.2.1 sensors + the contact registry

### Determinism, save/load, netcode

- [ ] Snapshot / restore — `StateRecorderImpl` + `PhysicsSystem.SaveState` / `RestoreState`, exposed as `api.saveState()` / `api.restoreState(bytes)`
- [ ] `StateRecorderImpl.IsEqual` as a determinism assertion, wired into a CI test that runs a scene twice and compares
- [ ] `StateRecorderJS` for custom streams (network transport)
- [ ] **Per-object** `SaveState` / `RestoreState` on `Body`, `Constraint` and `CharacterBase` (jolt 0.30.0) — snapshot only what changed instead of the whole world, which is what makes rollback affordable
- [ ] `StateRecorderFilter` plus multi-part save/restore (jolt 0.27.0), so a snapshot can be split across frames or across a network MTU
- [ ] Deterministic character identity — `CharacterID` and `CharacterVirtual`'s `mInnerBodyIDOverride`, both added upstream specifically for client/server setups
- [ ] Rollback support — a ring buffer of snapshots plus re-simulation on late input, with a documented worked example
- [ ] Strictly fixed-step loop decoupled from rendering, building on 0.3.0's `updateLoop: "independent"`
- [ ] **Creation-order stability** — snapshots only restore correctly if bodies are created in the same order, which React's mount order does **not** guarantee. Needs an explicit stable-id mechanism; the hardest correctness problem in this phase, and it should fail loudly rather than silently scrambling bodies
- [ ] Document the honest limits: determinism holds for the same build and platform; cross-browser float determinism is not guaranteed, and soft bodies/ragdolls must be constructed identically

### Verification

- [ ] Test tank and motorcycle mount/unmount teardown parity with `useCar`
- [ ] Test `MutableCompoundShape` add/remove/modify keeps mass properties sane after `AdjustCenterOfMass()`
- [ ] Test heightfield `SetHeights` updates both physics and render geometry
- [ ] CI determinism test: identical scene run twice, `StateRecorderImpl.IsEqual` passes
- [ ] Test snapshot restore with bodies created in a different mount order fails loudly

---

## 0.6.0 — Hair, rope and cables (Cosserat rods)

**Agreed scope:** hair with guide strands · rope and cables · oriented strand rendering. Cosserat rods carry an orientation per segment, so unlike a distance chain they resist twisting and expose a material frame for rendering. Same primitive serves hair, rope, cables, chains, tails and vines.

### Rod primitive

- [ ] `useRope` / `useCable` from a polyline: one `RodStretchShear` per segment, one `RodBendTwist` per adjacent pair, then `CalculateRodProperties()`
- [ ] Stretch, shear and bend/twist compliance exposed separately — they are independent constraints, and tuning them as one is what makes rope feel wrong
- [ ] Pin either or both ends via `mInvMass = 0`
- [ ] Attach an end to a rigid body, for grapples, tow ropes and pulleys
- [ ] Set `mOmega0` from the rest geometry so a pre-curled strand relaxes to its authored curl

### Hair

- [ ] `useHair` taking guide strands, from a groom export or generated from a scalp mesh
- [ ] Root pinning to a skeleton bone, reusing the 0.4.0 skeleton bridge
- [ ] `mSkinnedConstraints` + `SkinVertices()` as an alternative binding, keeping strands near an animated shape
- [ ] LRA constraints (`ELRAType_EuclideanDistance` / `GeodesicDistance`) to stop strands stretching under fast head motion — the classic hair failure mode
- [ ] Roots skinned to a scalp **mesh**, alongside pinning to a bone
- [ ] Guide-strand → rendered-strand interpolation, so a few hundred simulated strands drive thousands of rendered ones
- [ ] Collision against the character's own colliders without strands catching
- [ ] Environment collision: expect convex-hull and compound shapes to behave best — upstream's hair system supports only those
- [ ] Hair-vs-hair collision by accumulating average velocity in a grid and driving strands from it — the technique upstream's GPU system uses, and the affordable alternative to the self-collision below
- [ ] Self-collision: document as expensive and usually not worth enabling

### Rendering

The bulk of the work is here, not in the simulation.

- [ ] Tube geometry per strand, oriented from `GetRodRotation(i)` — a distance chain has no frame, so its tubes twist arbitrarily
- [ ] Camera-facing ribbon mode for hair cards
- [ ] Instanced strand rendering, thousands of strands in a handful of draw calls
- [ ] Allocation-free per-frame update: heap views straight into `BufferAttribute`s, matching the 0.4.0 soft-body sync discipline
- [ ] Optional LOD: fewer simulated segments and interpolated strands with distance

### Verification

- [ ] Test a pinned rope reaches a stable catenary and stays within epsilon of it
- [ ] Test rod rotations produce a continuous frame along a strand (no flips between adjacent segments)
- [ ] Test hair roots track a bone exactly while tips lag
- [ ] Test strands do not stretch beyond the LRA limit under a fast root snap
- [ ] Test per-frame strand update allocates nothing across N frames
- [ ] Demo: character with simulated hair plus a tow cable between two vehicles

---

## Not available in the JS bindings

Upstream Jolt C++ has these; `jolt-physics@1.1.0` does not bind them, so they are absent from the roadmap rather than overlooked. Verified against its type declarations.

| Feature | Consequence |
|---|---|
| Rigid-body character (`Character`) | Only `CharacterVirtual` is available. Upstream's rigid-body character is the cheaper option and interacts more accurately with dynamic bodies, so this is a genuine capability gap |
| `SkeletonMapper` | High-detail ↔ low-detail skeleton mapping is implemented in JS instead — see 0.4.0 |
| GPU strand-based hair system | Not exposed — upstream's 1.1.0 notes state "new hair system is not exposed as compute is not JS compatible yet". Only the underlying Cosserat rod constraints are bound, so 0.6.0 rebuilds the guide/follow split and velocity-grid collision on top of them |
| Double precision / large worlds | Supported as a cmake build option since jolt 0.18.0, but **no double-precision build is published to npm** — every published entry point is single precision. `RVec3`/`RMat44` appear in the type surface because the C++ is templated. Using it means building the bindings yourself |

---

## Jolt capability inventory — what is exposed vs. available

From the 336 classes in `jolt-physics@1.1.0`. Useful for spotting future opportunities.

| Subsystem                                                               | Status                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closest-hit raycast | exposed (broken; fixed in 0.2.0) |
| Rigid bodies, 8 shape types | exposed (being fixed in 0.2.0) |
| `CharacterVirtual` | exposed |
| `WheeledVehicleController` | exposed |
| Contact events | 0.2.0 |
| Injected Jolt module — unlocks multithreaded / debug / asm / custom builds | 0.2.0 |
| Mask-based collision filtering (`BroadPhaseLayerInterfaceMask`, `ObjectLayerPairFilterMask`) | 0.2.0 |
| `AssertFailedHandlerJS` + debug build, for the test suite | 0.2.0 |
| Any/all raycasts | 0.2.1 |
| Kinematic, sensors, damping, DOF locks, sleep | 0.2.1 |
| All 12 constraint types + motors | 0.3.0 |
| Batch body add/remove · per-triangle mesh user data · heightfield materials | 0.3.0 |
| Heightfield, tapered cylinder, scaled shapes | 0.3.0 |
| Instancing, auto-colliders | 0.3.0 |
| Shape casts, point/overlap queries | 0.3.0 |
| Buoyancy | 0.4.0 |
| Character inner rigid body, compound character shapes, `CharacterID` | 0.4.0 |
| Soft bodies, cloth, skinned constraints | 0.4.0 |
| `CharacterVsCharacterCollision` | 0.4.0 |
| `Ragdoll`, `Skeleton`, `SkeletonPose`, `SkeletalAnimation` | 0.4.0 |
| `SimShapeFilter` — cheap sim shape + detailed query shape in one body | 0.4.0 |
| `MutableCompoundShape`, terrain deformation | 0.5.0 |
| `PathConstraint`, gear/rack/pulley | 0.5.0 |
| `StateRecorder`, save/load, determinism | 0.5.0 |
| `TrackedVehicleController`, `MotorcycleController` | 0.5.0 |
| Cosserat rods (`RodStretchShear` / `RodBendTwist`) — hair, rope, cables | 0.6.0 |
| **Deliberately not scheduled** | `GroupFilterJS` — a JS callback per potential collision pair, inside the step. One WASM→JS crossing per pair would dominate the frame; `GroupFilterTable` covers ragdoll self-collision declaratively · custom `BroadPhaseLayerInterface` / `ObjectVsBroadPhaseLayerFilter` from JS — same cost profile, and the mask and table variants cover every realistic scheme · `PhysicsStepListenerJS` — **not needed**: with the accumulator calling `Step(fixedDt, 1)` in a JS loop, each iteration already *is* a sub-step, so `useBeforePhysicsStep` is pure JS and cheaper. Only required if a caller passes `numCollisionSteps > 1` |
