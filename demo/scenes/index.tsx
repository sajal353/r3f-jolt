import type { ComponentType, ReactNode } from "react";

import { Box } from "./shapes/Box";
import { Sphere } from "./shapes/Sphere";
import { Capsule } from "./shapes/Capsule";
import { Cylinder } from "./shapes/Cylinder";
import { TaperedCapsule } from "./shapes/TaperedCapsule";
import { Convex } from "./shapes/Convex";
import { Compound } from "./shapes/Compound";
import { Trimesh } from "./shapes/Trimesh";

import { MotionTypes } from "./bodies/MotionTypes";
import { MassAndMaterial } from "./bodies/MassAndMaterial";
import { Damping } from "./bodies/Damping";
import { DofLocks } from "./bodies/DofLocks";
import { Sensors } from "./bodies/Sensors";
import { SleepWake } from "./bodies/SleepWake";
import { GravityFactor } from "./bodies/GravityFactor";
import { LayersAndMasks } from "./bodies/LayersAndMasks";
import { MotionQuality } from "./bodies/MotionQuality";

import { Conveyor } from "./control/Conveyor";
import { ForcesAndImpulses } from "./control/ForcesAndImpulses";
import { Velocities } from "./control/Velocities";
import { Teleport } from "./control/Teleport";
import { Kinematic } from "./control/Kinematic";
import { GrabAndScale } from "./control/GrabAndScale";

import { ClosestHit } from "./queries/ClosestHit";
import { AnyHit } from "./queries/AnyHit";
import { AllHits } from "./queries/AllHits";

import { BodyContacts } from "./events/BodyContacts";
import { RawListener } from "./events/RawListener";

import { Character } from "./systems/Character";
import { Car } from "./systems/Car";
import { Interpolation } from "./systems/Interpolation";
import { DebugRendering } from "./systems/DebugRendering";
import { StressTest } from "./systems/StressTest";
import { Instancing } from "./systems/Instancing";

export interface Scene {
  name: string;
  Component: ComponentType;
  hook: string;
  hint: ReactNode;
  /** Whether `<PhysicsDebug />` starts on. Off for scenes it would drown. */
  physicsDebug?: boolean;
  /** Starting timestep. Defaults to `"vary"`; only scenes about a fixed step set it. */
  timeStep?: number | "vary";
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
        name: "Motion quality",
        Component: MotionQuality,
        hook: "motionQuality",
        // The tunnelling only happens at a step long enough to skip the pane,
        // and `vary` on a fast display is not.
        timeStep: 1 / 60,
        hint: (
          <>
            Two bullets at 70 m/s into a 6 cm pane, at a fixed{" "}
            <code>1/60</code> — 1.2 m of travel per step, so the{" "}
            <code>discrete</code> one is above the pane on one step and below it
            on the next. <code>linearCast</code> sweeps the gap instead.
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
        physicsDebug: false,
        hint: (
          <>
            A surface that drags what rests on it while the body stays put. The
            circuit reverses as one line because every belt carries the same{" "}
            <i>local</i> velocity and differs only in placement; the blue belt is
            turned a full 90°, and the disc uses <code>angular</code> alone.
            Friction does the dragging, so a frictionless belt carries nothing.
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
    ],
  },
  {
    name: "Systems",
    scenes: [
      {
        name: "Character",
        Component: Character,
        hook: "useCharacter",
        physicsDebug: false,
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
        physicsDebug: false,
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
        name: "Stress test",
        Component: StressTest,
        hook: "everything at once",
        physicsDebug: false,
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
        hook: "useJolt, shapeToGeometry",
        physicsDebug: false,
        hint: (
          <>
            1050 bodies in <b>seven</b> draw calls — 150 each of the seven
            convex shape kinds, one <code>InstancedMesh</code> apiece. No body
            hook is used: a hook is one React component, one mesh and one{" "}
            <code>useFrame</code> per body, which is the right trade up to a few
            hundred and the wrong one past that. Bodies come from{" "}
            <code>useJolt()</code> and their transforms are written into the
            instance matrices each frame — skipping the ones Jolt has put to
            sleep, whose matrices are already right. One Jolt shape is shared by
            all 150 of its kind: the same saving on the physics side that
            instancing is on the render side.
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
