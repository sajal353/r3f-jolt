import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "./Jolt/Physics";
import Scene from "./Scene";
import { Suspense } from "react";

const App = () => {
  return (
    <>
      <Canvas
        camera={{
          position: [0, 5, 10],
          near: 0.1,
          far: 1000,
          fov: 45,
        }}
      >
        <ambientLight />
        <OrbitControls />
        <Suspense fallback={null}>
          <Physics>
            <Scene />
          </Physics>
        </Suspense>
      </Canvas>
    </>
  );
};

export default App;
