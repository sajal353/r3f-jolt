import type { ComponentType, ReactNode } from "react";

import { Box } from "./shapes/Box";
import { Sphere } from "./shapes/Sphere";
import { Capsule } from "./shapes/Capsule";
import { Cylinder } from "./shapes/Cylinder";
import { TaperedCapsule } from "./shapes/TaperedCapsule";
import { Convex } from "./shapes/Convex";
import { Compound } from "./shapes/Compound";
import { Trimesh } from "./shapes/Trimesh";
import { Plane } from "./shapes/Plane";
import { HeightField } from "./shapes/HeightField";
import { TerrainSources } from "./shapes/TerrainSources";
import { TaperedCylinder } from "./shapes/TaperedCylinder";
import { Empty } from "./shapes/Empty";
import { SurfaceTypes } from "./shapes/SurfaceTypes";

import { MotionTypes } from "./bodies/MotionTypes";
import { MassAndMaterial } from "./bodies/MassAndMaterial";
import { Damping } from "./bodies/Damping";
import { DofLocks } from "./bodies/DofLocks";
import { Sensors } from "./bodies/Sensors";
import { SleepWake } from "./bodies/SleepWake";
import { GravityFactor } from "./bodies/GravityFactor";
import { LayersAndMasks } from "./bodies/LayersAndMasks";
import { CollisionGroups } from "./bodies/CollisionGroups";
import { AutoColliders } from "./bodies/AutoColliders";
import { MotionQuality } from "./bodies/MotionQuality";

import { Conveyor } from "./control/Conveyor";
import { ForcesAndImpulses } from "./control/ForcesAndImpulses";
import { Velocities } from "./control/Velocities";
import { Teleport } from "./control/Teleport";
import { Kinematic } from "./control/Kinematic";
import { GrabAndScale } from "./control/GrabAndScale";

import { FixedConstraintScene } from "./constraints/Fixed";
import { PointConstraintScene } from "./constraints/Point";
import { HingeConstraintScene } from "./constraints/Hinge";
import { SliderConstraintScene } from "./constraints/Slider";
import { DistanceConstraintScene } from "./constraints/Distance";
import { ConeAndSwingTwistScene } from "./constraints/ConeAndSwingTwist";
import { SixDOFConstraintScene } from "./constraints/SixDOF";
import { MotorsScene } from "./constraints/Motors";
import { SpringsScene } from "./constraints/Springs";

import { ClosestHit } from "./queries/ClosestHit";
import { AnyHit } from "./queries/AnyHit";
import { AllHits } from "./queries/AllHits";
import { ShapeCast } from "./queries/ShapeCast";
import { ShapeOverlap } from "./queries/ShapeOverlap";
import { PointQuery } from "./queries/PointQuery";

import { BodyContacts } from "./events/BodyContacts";
import { RawListener } from "./events/RawListener";
import { SensorVolumes } from "./events/SensorVolumes";
import { ContactForce } from "./events/ContactForce";

import { Character } from "./systems/Character";
import { Car } from "./systems/Car";
import { Interpolation } from "./systems/Interpolation";
import { StepCallbacks } from "./systems/StepCallbacks";
import { DebugRendering } from "./systems/DebugRendering";
import { StressTest } from "./systems/StressTest";
import { Instancing } from "./systems/Instancing";
import { ManualStepping } from "./systems/ManualStepping";
import { Breakable } from "./systems/Breakable";

export interface Scene {
  name: string;
  Component: ComponentType;
  hook: string;
  hint: ReactNode;
  /** Starts `<PhysicsDebug />` on. Off everywhere unless the scene is about it. */
  physicsDebug?: boolean;
  /** Starting timestep. Defaults to `"vary"`; only scenes about a fixed step set it. */
  timeStep?: number | "vary";
  /** `"independent"` leaves the world still until the scene steps it itself. */
  updateLoop?: "follow" | "independent";
}

export interface Category {
  name: string;
  scenes: Scene[];
}

export const categories: Category[] = [
  {
    name: "Shapes",
    scenes: [
      {
        name: "Box",
        Component: Box,
        hook: "useBox",
        hint: (
          <>
            Sizes are <b>full extents</b>, not half. <code>convexRadius</code>{" "}
            rounds the collider and defaults to a fraction of the size rather
            than a fixed value, which was wrong on small shapes.
          </>
        ),
      },
      {
        name: "Sphere",
        Component: Sphere,
        hook: "useSphere",
        hint: (
          <>
            Four identical drops, <code>restitution</code> 0 → 1. The floor has
            its own restitution; Jolt combines the two.
          </>
        ),
      },
      {
        name: "Capsule",
        Component: Capsule,
        hook: "useCapsule",
        hint: (
          <>
            <code>height</code> is the cylindrical middle only — total height is{" "}
            <code>height + 2 × radius</code>. Capsules never catch on seams,
            which is why characters use them.
          </>
        ),
      },
      {
        name: "Cylinder",
        Component: Cylinder,
        hook: "useCylinder",
        hint: (
          <>
            Flat ends, so unlike a capsule it stands up and topples. The third
            one is rotated onto its side at creation and rolls.
          </>
        ),
      },
      {
        name: "Tapered capsule",
        Component: TaperedCapsule,
        hook: "useTaperedCapsule",
        hint: (
          <>
            Different radius at each end — cones, teardrops, bullets. There is
            no three primitive for it, so the mesh uses{" "}
            <code>api.geometry</code>, the collider's own triangulation.
          </>
        ),
      },
      {
        name: "Convex hull",
        Component: Convex,
        hook: "useConvex",
        hint: (
          <>
            A hull wrapped around whatever points you pass. The third body is
            given an interior point as well — a hull cannot be concave, so it is
            simply inside the shape and changes nothing.
          </>
        ),
      },
      {
        name: "Compound",
        Component: Compound,
        hook: "useCompound",
        hint: (
          <>
            Several primitives welded into <b>one</b> rigid body. The third has
            a child with radius −1: it is skipped with a console error and the
            rest still builds.
          </>
        ),
      },
      {
        name: "Trimesh",
        Component: Trimesh,
        hook: "useTrimesh",
        hint: (
          <>
            Exact triangle geometry, from a <code>BufferGeometry</code> or raw
            arrays. <b>Always static</b> — Jolt mesh shapes cannot be dynamic.
          </>
        ),
      },
      {
        name: "Plane",
        Component: Plane,
        hook: "usePlane",
        hint: (
          <>
            Jolt's plane is <b>not infinite</b>: <code>halfExtent</code> bounds
            the collider (60 here) and <code>renderSize</code> sizes the mesh
            (20). Balls roll off the visible floor and keep rolling.
          </>
        ),
      },
      {
        name: "Height field",
        Component: HeightField,
        hook: "useHeightField",
        hint: (
          <>
            64² samples, a byte each, where the same terrain as a{" "}
            <code>useTrimesh</code> costs roughly 8 000 triangles. The red ball
            drops through a <b>hole</b> — a <code>null</code> sample.{" "}
            <i>raise a hill</i> is <code>setHeights</code>, which only works
            because <code>range</code> reserved headroom at build time.
          </>
        ),
      },
      {
        name: "Terrain sources",
        Component: TerrainSources,
        hook: "useHeightField",
        hint: (
          <>
            The three shapes <code>heights</code> accepts: a <b>function</b>{" "}
            called once per sample, a row-major <b>Float32Array</b>, and
            greyscale <b>image data</b> from a PNG, fetched only when picked.
            Holes are <code>null</code> from a function, <code>NaN</code> from
            an array. Drive with <b>WASD</b>, <b>R</b> resets.
          </>
        ),
      },
      {
        name: "Tapered cylinder",
        Component: TaperedCylinder,
        hook: "useTaperedCylinder",
        hint: (
          <>
            Two radii and <b>flat ends</b> — cones and truncated cones. The
            rounded caps of a <code>useTaperedCapsule</code> roll; these stand.
          </>
        ),
      },
      {
        name: "Empty",
        Component: Empty,
        hook: "useEmpty",
        hint: (
          <>
            The yellow marker is a body with <b>no collider</b>: crates fall
            through it, the weight still hangs off it. A one-sided constraint
            bolts to the world; this is the anchor for when it has to move.
          </>
        ),
      },
      {
        name: "Surface types",
        Component: SurfaceTypes,
        hook: "useTrimesh",
        hint: (
          <>
            Every triangle carries a 32-bit tag from{" "}
            <code>triangleUserData</code>, read back through{" "}
            <code>api.getTriangleUserData(hit.subShapeID)</code>. Footstep audio
            and per-surface tyre grip are the same lookup.
          </>
        ),
      },
    ],
  },
  {
    name: "Body options",
    scenes: [
      {
        name: "Motion types",
        Component: MotionTypes,
        hook: "motionType",
        hint: (
          <>
            <b>static</b> never moves · <b>kinematic</b> moves only when you
            move it, and pushes things · <b>dynamic</b> is driven by forces.
            Colours match <code>&lt;PhysicsDebug /&gt;</code>.
          </>
        ),
      },
      {
        name: "Mass & material",
        Component: MassAndMaterial,
        hook: "mass, material",
        hint: (
          <>
            A heavy ball dropped on blocks of mass 1 / 10 / 100 / derived, and
            three boxes on a ramp at <code>friction</code> 0 / 0.5 / 1.5. Omit{" "}
            <code>mass</code> and Jolt derives it from volume.
          </>
        ),
      },
      {
        name: "Damping",
        Component: Damping,
        hook: "linearDamping, angularDamping",
        hint: (
          <>
            Gravity and friction are off, so damping is the only thing slowing
            anything down. Jolt's default is <code>0.05</code> for both — worth
            setting to <code>0</code> if you want impulses to map exactly to
            velocity.
          </>
        ),
      },
      {
        name: "DOF locks",
        Component: DofLocks,
        hook: "lockRotations, enabledRotations",
        hint: (
          <>
            Same spin and velocity on all four, different degrees of freedom.
            Locks are <b>world</b>-space, not local — "rotation X" means the
            world X axis however the body is facing.
          </>
        ),
      },
      {
        name: "Sensors",
        Component: Sensors,
        hook: "sensor",
        hint: (
          <>
            A sensor reports contacts and imparts no impulse, so bodies fall
            through it. It still needs a layer that collides — the collision
            test is what reports; only the response is skipped.
          </>
        ),
      },
      {
        name: "Sleep & wake",
        Component: SleepWake,
        hook: "onSleep, onWake",
        hint: (
          <>
            Jolt deactivates bodies that come to rest. Click one to punch it
            awake. Events arrive <b>after</b> the step, not from inside it, so
            calling <code>setState</code> in them is safe.
          </>
        ),
      },
      {
        name: "Gravity factor",
        Component: GravityFactor,
        hook: "gravityFactor",
        hint: (
          <>
            Per-body gravity scaling without touching world gravity. Negative
            floats, <code>0</code> hangs, above <code>1</code> falls harder.
          </>
        ),
      },
      {
        name: "Layers & masks",
        Component: LayersAndMasks,
        hook: "group, mask, layer",
        hint: (
          <>
            Each ball lands on its own shelf and ignores the other. Two bodies
            collide only when <i>each</i> one's mask contains the other's group
            — 16 bits of each, packed into one 32-bit layer.
          </>
        ),
      },
      {
        name: "Collision groups",
        Component: CollisionGroups,
        hook: "collisionGroup, useGroupFilterTable",
        hint: (
          <>
            One level below layers: which <i>individual</i> bodies ignore each
            other. Adjacent links are filtered out on the right, so the chain
            stops fighting its own joints.
          </>
        ),
      },
      {
        name: "Auto colliders",
        Component: AutoColliders,
        hook: "useAutoCollider",
        physicsDebug: true,
        hint: (
          <>
            The collider is read off the mesh, so the size is written once — in
            the JSX. Debug is on so you can see what each mode derived. The
            orange one is modelled with its feet at the origin, and the collider
            is offset to match rather than sitting half a body low.
          </>
        ),
      },
      {
        name: "Motion quality",
        Component: MotionQuality,
        hook: "motionQuality",
        // The tunnelling only happens at a step long enough to skip the pane,
        // and `vary` on a fast display is not.
        timeStep: 1 / 60,
        hint: (
          <>
            Two bullets at 70 m/s into a 6 cm pane, at a fixed <code>1/60</code>{" "}
            — 1.2 m of travel per step, so the <code>discrete</code> one is
            above the pane on one step and below it on the next.{" "}
            <code>linearCast</code> sweeps the gap instead.
          </>
        ),
      },
    ],
  },
  {
    name: "Control",
    scenes: [
      {
        name: "Forces & impulses",
        Component: ForcesAndImpulses,
        hook: "applyForce, applyImpulse",
        hint: (
          <>
            Force accumulates over a step and must be re-applied every frame;
            impulse is instantaneous. Passing a <b>point</b> applies it off the
            centre of mass, which is what makes things spin.
          </>
        ),
      },
      {
        name: "Velocities",
        Component: Velocities,
        hook: "setLinearVelocity, setVelocities",
        hint: (
          <>
            Setting velocity replaces it outright, so the result does not depend
            on mass or on what the body was already doing. Zeroing it is how you
            stop something dead.
          </>
        ),
      },
      {
        name: "Teleport vs drive",
        Component: Teleport,
        hook: "setPositionAndRotation",
        hint: (
          <>
            The same path at the same speed. The red block teleports and passes
            straight through the ball; the green one is driven with{" "}
            <code>moveKinematic</code> and pushes it. A teleport carries{" "}
            <b>no velocity</b>.
          </>
        ),
      },
      {
        name: "Kinematic platform",
        Component: Kinematic,
        hook: "moveKinematic",
        hint: (
          <>
            A platform that carries its crates, a sensor volume, and a wall
            built through <code>useJolt</code> with no mesh — only{" "}
            <b>PhysicsDebug</b> draws that one.
          </>
        ),
      },
      {
        name: "Grab & scale",
        Component: GrabAndScale,
        hook: "grab, moveTo, release, setScale",
        hint: (
          <>
            Drag a cube, <code>[</code> / <code>]</code> to resize, let go to
            throw. The pointer stands in for an XR controller. The throw is free
            — <code>release</code> applies no impulse; the carry already built
            the velocity.
          </>
        ),
      },
      {
        name: "Conveyor",
        Component: Conveyor,
        hook: "useConveyor",
        hint: (
          <>
            A surface that drags what rests on it while the body stays put. The
            circuit reverses as one line because every belt carries the same{" "}
            <i>local</i> velocity and differs only in placement; the blue belt
            is turned a full 90°, and the disc uses <code>angular</code> alone.
            Friction does the dragging, so a frictionless belt carries nothing.
          </>
        ),
      },
    ],
  },
  {
    name: "Constraints",
    scenes: [
      {
        name: "Fixed",
        Component: FixedConstraintScene,
        hook: "useFixedConstraint",
        hint: (
          <>
            Welds bodies together. <code>autoDetectPoint</code> is on by
            default, so the joint locks them exactly where you placed them and
            needs no anchor points. The welded tower topples in one piece; the
            plain stack beside it scatters.
          </>
        ),
      },
      {
        name: "Point",
        Component: PointConstraintScene,
        hook: "usePointConstraint",
        hint: (
          <>
            A ball joint: the anchor points are held together and every rotation
            stays free. Passing <code>null</code> as the first body joins to the
            world, which is what holds each chain up without a static block.
            Turn on <code>PhysicsDebug</code> to see every joint drawn in gold.
          </>
        ),
      },
      {
        name: "Hinge",
        Component: HingeConstraintScene,
        hook: "useHingeConstraint",
        hint: (
          <>
            One rotation about a shared axis. <code>limits</code> are radians
            measured from where the two <code>normalAxis</code> vectors line up
            — equal min and max holds the door shut.
          </>
        ),
      },
      {
        name: "Slider",
        Component: SliderConstraintScene,
        hook: "useSliderConstraint",
        hint: (
          <>
            One translation along a shared axis. <code>maxFrictionForce</code>{" "}
            resists travel without stopping it, and a vertical slider is held up
            by nothing but its own lower limit.
          </>
        ),
      },
      {
        name: "Distance",
        Component: DistanceConstraintScene,
        hook: "useDistanceConstraint",
        hint: (
          <>
            Keeps two points within a range. Equal min and max is a rigid rod; a
            min of zero stays slack until it runs out, which is why the red ball
            drops before it swings. Chain a line of light bodies the same way
            and you have rope — no rope hook required, just one joint per link.
          </>
        ),
      },
      {
        name: "Cone & swing-twist",
        Component: ConeAndSwingTwistScene,
        hook: "useConeConstraint, useSwingTwistConstraint",
        hint: (
          <>
            Both limit how far a body may lean away from its twist axis. Only
            swing-twist also bounds rotation <i>about</i> that axis — the two
            green reeds have the same lean limit and opposite twist limits.
          </>
        ),
      },
      {
        name: "Six DOF",
        Component: SixDOFConstraintScene,
        hook: "useSixDOFConstraint",
        hint: (
          <>
            Every axis is separately <code>free</code>, <code>fixed</code> or
            limited, with its own spring, friction and motor. The other seven
            constraint hooks are shortcuts for its common configurations.
          </>
        ),
      },
      {
        name: "Motors",
        Component: MotorsScene,
        hook: "motor, setTargetAngle, setTargetPosition",
        hint: (
          <>
            A <b>position</b> motor holds a target and carries load; a{" "}
            <b>velocity</b> motor turns at a rate. Hand a position motor a
            distant target and it closes the gap as fast as its force limit
            allows, so gravity makes the lift drop quicker than it rises — the
            door and the lift here walk their targets over at a fixed rate
            instead, which is what makes both directions take the same time.
            Every runtime setter wakes both bodies first: a settled joint is
            asleep, and would otherwise ignore its new target entirely.
          </>
        ),
      },
      {
        name: "Springs",
        Component: SpringsScene,
        hook: "limitsSpring",
        hint: (
          <>
            The spring sits on the joint's <i>limits</i>, so each bob falls
            freely and the spring only decides how it settles at the stop. Low
            frequency and damping oscillate; high values arrive and stay.
            Re-dropped every six seconds.
          </>
        ),
      },
    ],
  },
  {
    name: "Queries",
    scenes: [
      {
        name: "Closest hit",
        Component: ClosestHit,
        hook: "useClosestHitRaycaster",
        hint: (
          <>
            The nearest body along the ray, with point, normal, distance and
            body id. <code>distance</code> is{" "}
            <code>fraction × |direction|</code>, so the ray's length is
            meaningful.
          </>
        ),
      },
      {
        name: "Any hit",
        Component: AnyHit,
        hook: "useAnyHitRaycaster",
        hint: (
          <>
            Line of sight. Jolt stops at the first hit it meets rather than
            comparing distances, which makes this the cheapest cast — and means
            the hit it reports is <b>not</b> necessarily the nearest.
          </>
        ),
      },
      {
        name: "All hits",
        Component: AllHits,
        hook: "useAllHitsRaycaster",
        hint: (
          <>
            Every body the ray crosses, sorted nearest-first. The array and the
            hits in it are reused between casts, so copy anything you keep.
          </>
        ),
      },
      {
        name: "Shape cast",
        Component: ShapeCast,
        hook: "useShapeCaster",
        hint: (
          <>
            One 0.9-wide capsule sliding along a wall, swept at it from a fixed
            distance. It clears the 1.6 and 1.0 gaps and is stopped by the 0.6
            one. A ray is a line with no width and would go through all three.
          </>
        ),
      },
      {
        name: "Shape overlap",
        Component: ShapeOverlap,
        hook: "useShapeOverlap, useBroadphaseQuery",
        hint: (
          <>
            A sphere sweeping through a wall of crates: green is what it is
            touching, orange is what the broadphase names for the same region.
            The broadphase compares bounding boxes and never looks at a shape,
            so its answer is always a superset.
          </>
        ),
      },
      {
        name: "Point query",
        Component: PointQuery,
        hook: "usePointQuery",
        hint: (
          <>
            The pointer projected onto the z=0 plane, asking which body is at
            that point. A short ray cannot stand in for it: a ray has to{" "}
            <i>enter</i> a body, so one starting inside reports nothing.
          </>
        ),
      },
    ],
  },
  {
    name: "Events",
    scenes: [
      {
        name: "Body contacts",
        Component: BodyContacts,
        hook: "useBodyContacts",
        hint: (
          <>
            Per-body <code>onEnter</code> / <code>onStay</code> /{" "}
            <code>onExit</code>, delivered after the step with the data copied
            out. Safe for <code>setState</code> and for <code>api.kill()</code>.
          </>
        ),
      },
      {
        name: "Raw listener",
        Component: RawListener,
        hook: "useContactListener",
        hint: (
          <>
            Runs <b>inside</b> the step, so it can change a contact before it is
            solved — restitution per pad here, and rejecting contacts outright
            to make one pad a ghost. Retain nothing; create no bodies.
          </>
        ),
      },
      {
        name: "Sensor volumes",
        Component: SensorVolumes,
        hook: "useSensor",
        hint: (
          <>
            Intersection events plus the set of bodies currently inside. The
            count holds after the balls fall asleep — Jolt drops a sensor
            contact when a body sleeps, and the hook holds that exit back.
          </>
        ),
      },
      {
        name: "Contact force",
        Component: ContactForce,
        hook: "contactForce",
        hint: (
          <>
            How hard, not just whether. Four weights land on sprung platforms at
            the same speed, and the sink follows the impulse. An{" "}
            <b>estimate</b>: Jolt reports no applied impulse.
          </>
        ),
      },
    ],
  },
  {
    name: "Systems",
    scenes: [
      {
        name: "Character",
        Component: Character,
        hook: "useCharacter",
        hint: (
          <>
            <code>WASD</code> to move, <code>Space</code> to jump,{" "}
            <code>Shift</code> to crouch. Green ramps are inside{" "}
            <code>maxSlopeAngle</code> and red ones are past it — the readout
            says which the character is on. It also climbs stairs, shoves
            crates, and rides the platform. Its position is its <b>feet</b>.
          </>
        ),
      },
      {
        name: "Car",
        Component: Car,
        hook: "useCar",
        hint: (
          <>
            <code>WASD</code> to drive, <code>Space</code> for handbrake,{" "}
            <code>Shift</code> for full throttle, <code>R</code> to reset. A
            real <code>WheeledVehicleController</code>: engine, transmission,
            differentials, anti-roll bars. Handbrake is rear-only; the service
            brake splits 80/20 front/rear.
          </>
        ),
      },
      {
        name: "Interpolation",
        Component: Interpolation,
        hook: "<Physics interpolate>",
        // Interpolation is forced off for `vary`, which already lands exactly
        // one step per frame — this is the one scene that needs a fixed step.
        timeStep: 1 / 15,
        hint: (
          <>
            The green mesh is interpolated; the red dot is the raw simulation
            position. This scene starts at a fixed <code>1/15</code> because
            interpolation has nothing to do at <code>vary</code>: one step per
            frame is already in step with the renderer. The gap between the two
            is the one step of latency interpolation costs.
          </>
        ),
      },
      {
        name: "Step callbacks",
        Component: StepCallbacks,
        hook: "useBeforePhysicsStep, useAfterPhysicsStep",
        // Two steps a frame at 60 Hz, so the per-frame ring is pulled twice as
        // hard as it should be. Anything faster only makes the point louder.
        timeStep: 1 / 30,
        hint: (
          <>
            Two rings, same inverse-square pull, each meant to trace the grey
            circle drawn through it. The left takes its pull from{" "}
            <code>useBeforePhysicsStep</code>, once per step; the right from a{" "}
            <code>useFrame</code>, once per frame. A fixed timestep is not a
            frame, so the right ring gets the wrong amount of force and leaves
            its circle. Switch to <b>vary</b>, where one frame is one step, and
            both hold it. Trails are sampled per step, from{" "}
            <code>useAfterPhysicsStep</code>.
          </>
        ),
      },
      {
        name: "Stress test",
        Component: StressTest,
        hook: "everything at once",
        hint: (
          <>
            All seven dynamic shape hooks spawning continuously to a cap of 1500
            bodies, over a static trimesh, with two kinematic bodies ploughing
            through them, a conveyor belt dragging whatever lands on it towards
            the far wall, a sensor, a raw contact listener, all three
            raycasters, a grab/scale/throw loop, a vehicle and a character — all
            running at the same time. The readout is live. Switch to a fixed{" "}
            <code>1/60</code> and it will jitter: a frame that takes longer than
            one step leaves the world owing steps it can never repay.
          </>
        ),
      },
      {
        name: "Instancing",
        Component: Instancing,
        hook: "useInstancedBodies",
        hint: (
          <>
            1050 bodies in <b>seven</b> draw calls — 150 each of seven collider
            kinds, one <code>InstancedMesh</code> apiece. A body hook is one
            component, one mesh and one <code>useFrame</code> per body, which is
            the right trade up to a few hundred and the wrong one past that.
            Each kind shares one Jolt shape and is added in a single batch.
          </>
        ),
      },
      {
        name: "Manual stepping",
        Component: ManualStepping,
        hook: "updateLoop, api.step",
        updateLoop: "independent",
        timeStep: 1 / 60,
        hint: (
          <>
            Nothing steps this world but the buttons. <code>updateLoop</code> of{" "}
            <code>"independent"</code> takes the world off the frame loop, and{" "}
            <code>api.step()</code> advances it exactly one step.
          </>
        ),
      },
      {
        name: "Breakable objects",
        Component: Breakable,
        hook: "useBodyContacts, useConvex",
        hint: (
          <>
            <b>Click to fire.</b> A dry-stacked brick wall — no joints, just
            friction — splitting two generations deep to a ceiling of{" "}
            <b>200 chunks</b>. A piece goes when the estimated impulse would
            change <i>its own</i> velocity by 0.8 m/s: <code>impulse</code> is
            momentum, so only a mass-relative threshold breaks a brick and its
            chips alike. The split runs from <code>useBodyContacts</code>, whose
            handler fires <b>between steps</b> — building bodies inside
            Jolt&apos;s own contact callback is illegal. <code>impulse</code> is
            an estimate, not a number Jolt reported.
          </>
        ),
      },
      {
        name: "Debug rendering",
        Component: DebugRendering,
        hook: "<PhysicsDebug />",
        hint: (
          <>
            Per-hook <code>debug</code> draws one collider coloured by shape
            kind. <code>&lt;PhysicsDebug /&gt;</code> draws{" "}
            <b>every body in the world</b> coloured by motion type, including
            the four here that have no mesh at all.
          </>
        ),
      },
    ],
  },
];

export const findScene = (name: string) =>
  categories
    .flatMap((category) => category.scenes)
    .find((s) => s.name === name);
