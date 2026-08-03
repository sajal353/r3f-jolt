import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Physics } from "@/Jolt/Physics";
import { PhysicsDebug } from "@/Jolt/PhysicsDebug";
import { categories, findScene } from "./scenes";

const TIME_STEPS: { label: string; value: number | "vary" }[] = [
  { label: "1/60", value: 1 / 60 },
  { label: "1/15", value: 1 / 15 },
  { label: "vary", value: "vary" },
];

const App = () => {
  const [sceneName, setSceneName] = useState(categories[0].scenes[0].name);
  const [debug, setDebug] = useState(false);
  const [debugOverride, setDebugOverride] = useState<boolean | null>(null);
  const [paused, setPaused] = useState(false);
  const [interpolate, setInterpolate] = useState(true);
  const [stepOverride, setStepOverride] = useState<number | "vary" | null>(
    null,
  );

  const scene = findScene(sceneName) ?? categories[0].scenes[0];
  const { Component, hint, hook } = scene;

  // A scene states its own starting point for these; the toolbar overrides it
  // until the next scene switch clears the override. `vary` — one step per
  // frame — is the default because it is what most apps should ship with.
  const globalDebug = debugOverride ?? scene.physicsDebug !== false;
  const timeStep = stepOverride ?? scene.timeStep ?? "vary";

  return (
    <>
      <nav className="sidebar">
        <div className="brand">
          r3f-jolt<span>examples</span>
        </div>

        {categories.map((category) => (
          <section key={category.name}>
            <h2>{category.name}</h2>
            {category.scenes.map((entry) => (
              <button
                key={entry.name}
                aria-current={entry.name === sceneName}
                onClick={() => {
                  setSceneName(entry.name);
                  setDebugOverride(null);
                  setStepOverride(null);
                }}
              >
                {entry.name}
              </button>
            ))}
          </section>
        ))}
      </nav>

      <div className="viewport">
        <div className="toolbar">
          <button aria-pressed={debug} onClick={() => setDebug((v) => !v)}>
            debug
          </button>
          <button
            aria-pressed={globalDebug}
            onClick={() => setDebugOverride(!globalDebug)}
          >
            PhysicsDebug
          </button>
          <button aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            {paused ? "paused" : "running"}
          </button>
          <button
            aria-pressed={interpolate}
            onClick={() => setInterpolate((v) => !v)}
          >
            interpolate
          </button>

          <span className="divider" />

          {TIME_STEPS.map((entry) => (
            <button
              key={entry.label}
              aria-pressed={timeStep === entry.value}
              onClick={() => setStepOverride(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="caption">
          <h1>
            {scene.name} <code>{hook}</code>
          </h1>
          <p>{hint}</p>
        </div>

        <Canvas
          shadows
          camera={{ position: [0, 9, 20], near: 0.1, far: 500, fov: 45 }}
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

          {/* Keying on the scene rebuilds the whole world on every switch, which
              is the mount/unmount stress this demo is meant to apply. */}
          <Physics
            key={sceneName}
            debug={debug}
            paused={paused}
            interpolate={interpolate}
            timeStep={timeStep}
          >
            {globalDebug && <PhysicsDebug />}
            <Suspense fallback={null}>
              <Component />
            </Suspense>
          </Physics>
        </Canvas>
      </div>
    </>
  );
};

export default App;
