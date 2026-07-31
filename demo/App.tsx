import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Physics } from "@/Jolt/Physics";
import { Shapes } from "./scenes/Shapes";
import { Character } from "./scenes/Character";
import { Car } from "./scenes/Car";
import { Raycast } from "./scenes/Raycast";
import { Contacts } from "./scenes/Contacts";

const scenes = {
  Shapes: {
    Component: Shapes,
    hint: (
      <>
        Every shape hook at once. Turn on <b>debug</b> to overlay the colliders
        Jolt actually simulates.
      </>
    ),
  },
  Character: {
    Component: Character,
    hint: (
      <>
        <code>WASD</code> to move, <code>Space</code> to jump,{" "}
        <code>Shift</code> to crouch. Movement is camera-relative — orbit, then
        walk up the ramp or the steps.
      </>
    ),
  },
  Car: {
    Component: Car,
    hint: (
      <>
        <code>WASD</code> to drive, <code>Space</code> for handbrake,{" "}
        <code>Shift</code> for full throttle. All-wheel drive with an anti-roll
        bar.
      </>
    ),
  },
  Raycast: {
    Component: Raycast,
    hint: (
      <>
        A sweeping <code>useClosestHitRaycaster</code>. The readout is the hit
        data the hook returns — body id, distance, fraction and normal.
      </>
    ),
  },
  Contacts: {
    Component: Contacts,
    hint: (
      <>
        <code>useBodyContacts</code> turns balls green on first touch and
        removes them with <code>api.kill()</code> when they land on the red pad.
      </>
    ),
  },
} as const;

type SceneName = keyof typeof scenes;

const App = () => {
  const [scene, setScene] = useState<SceneName>("Shapes");
  const [debug, setDebug] = useState(false);
  const [paused, setPaused] = useState(false);

  const { Component, hint } = scenes[scene];

  return (
    <>
      <div className="ui">
        <div className="scenes">
          {(Object.keys(scenes) as SceneName[]).map((name) => (
            <button
              key={name}
              aria-pressed={name === scene}
              onClick={() => setScene(name)}
            >
              {name}
            </button>
          ))}
          <button aria-pressed={debug} onClick={() => setDebug((v) => !v)}>
            debug
          </button>
          <button aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            {paused ? "paused" : "running"}
          </button>
        </div>
        <p className="hint">{hint}</p>
      </div>

      <Canvas
        shadows
        camera={{ position: [0, 8, 18], near: 0.1, far: 500, fov: 45 }}
      >
        <color attach="background" args={["#111111"]} />
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1.4}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <OrbitControls makeDefault />

        {/* Keying on `scene` rebuilds the whole world on every switch, which is
            the mount/unmount stress this demo is meant to apply. */}
        <Physics key={scene} debug={debug} paused={paused}>
          <Suspense fallback={null}>
            <Component />
          </Suspense>
        </Physics>
      </Canvas>
    </>
  );
};

export default App;
