import { StrictMode, useEffect, type ReactNode } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import initDebugJolt from "jolt-physics/debug-wasm-compat";
import type Jolt from "jolt-physics";
import { Physics } from "@/Jolt/Physics";
import type { JoltApi, JoltModule } from "@/Jolt/types";
import { useJolt } from "@/Jolt/useJolt";

let modulePromise: Promise<JoltModule> | null = null;

export const loadDebugModule = () => {
  modulePromise ??= initDebugJolt() as Promise<JoltModule>;
  return modulePromise;
};

let assertFailures: string[] = [];

export const takeAssertFailures = () => {
  const failures = assertFailures;
  assertFailures = [];
  return failures;
};

let assertHandler: Jolt.AssertFailedHandlerJS | null = null;

// Built once and reused: a handler per mount would itself leak 16 bytes a cycle
// and drown out the leak measurements these tests exist to make.
const installAssertHandler = (settings: Jolt.JoltSettings, jolt: JoltModule) => {
  if (!assertHandler) {
    assertHandler = new jolt.AssertFailedHandlerJS();
    assertHandler.OnAssertFailed = (
      _expression: number,
      _message: number,
      _file: number,
      line: number,
    ) => {
      assertFailures.push(`Jolt assertion failed (source line ${line})`);
    };
  }

  settings.mAssertFailedHandler = assertHandler;
};

const capture: { api: JoltApi | null } = { api: null };

const setCaptured = (value: JoltApi | null) => {
  capture.api = value;
};

const CaptureApi = () => {
  const api = useJolt();

  useEffect(() => {
    setCaptured(api);
  }, [api]);

  return null;
};

export const getApi = () => {
  if (!capture.api) throw new Error("physics api was not captured");
  return capture.api;
};

export interface RenderOptions {
  strict?: boolean;
  gravity?: [number, number, number];
  timeStep?: number | "vary";
}

export type PhysicsRenderer = Awaited<
  ReturnType<typeof ReactThreeTestRenderer.create>
>;

export const renderPhysics = async (
  children: ReactNode,
  { strict = false, gravity, timeStep }: RenderOptions = {},
) => {
  setCaptured(null);
  takeAssertFailures();

  const module = await loadDebugModule();

  const tree = (
    <Physics
      module={module}
      gravity={gravity}
      timeStep={timeStep}
      settingsOverride={installAssertHandler}
    >
      <CaptureApi />
      {children}
    </Physics>
  );

  const renderer = await ReactThreeTestRenderer.create(
    strict ? <StrictMode>{tree}</StrictMode> : tree,
  );

  for (let attempt = 0; attempt < 20 && !capture.api; attempt += 1) {
    await ReactThreeTestRenderer.act(async () => {
      await Promise.resolve();
    });
  }

  if (!capture.api) {
    throw new Error("<Physics> never provided a context value");
  }

  return renderer;
};

export const step = async (
  renderer: PhysicsRenderer,
  frames = 1,
  delta = 1 / 60,
) => {
  await ReactThreeTestRenderer.act(async () => {
    await renderer.advanceFrames(frames, delta);
  });
};

export const unmount = async (renderer: PhysicsRenderer) => {
  await ReactThreeTestRenderer.act(async () => {
    await renderer.unmount();
  });
};

export const expectNoAsserts = () => {
  const failures = takeAssertFailures();
  if (failures.length > 0) {
    throw new Error(
      `Jolt debug build reported ${failures.length} assertion failure(s):\n` +
        failures.join("\n"),
    );
  }
};
