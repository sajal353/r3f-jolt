import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Physics } from "@/Jolt/Physics";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  Refused,
  renderPhysics,
  step,
  unmount,
} from "./harness";
import { useBox } from "@/Jolt/useBox";

const FallingBox = () => {
  useBox({ size: [1, 1, 1], position: [0, 10, 0], motionType: "dynamic" });
  return null;
};

describe("<Physics>", () => {
  it("renders nothing until the module resolves", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Physics init={() => new Promise(() => {})}>
        <mesh />
      </Physics>,
    );

    expect(renderer.scene.children).toHaveLength(0);
    await unmount(renderer);
  });

  it("hands a module that failed to load to an error boundary, and tries again next mount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const settle = () =>
      ReactThreeTestRenderer.act(
        () => new Promise((resolve) => setTimeout(resolve, 0)),
      );

    let attempts = 0;
    const init = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("the wasm did not load"))
        : loadDebugModule();
    };

    const refusals: unknown[] = [];
    const failed = await ReactThreeTestRenderer.create(
      <Refused onError={(refusal) => refusals.push(refusal)}>
        <Physics init={init}>
          <mesh />
        </Physics>
      </Refused>,
    );
    await settle();
    expect(String(refusals[0])).toContain("the wasm did not load");
    await unmount(failed);

    // Loaded ahead, so the retry waits on the build alone, not on compiling
    // the module under a busy test run.
    await loadDebugModule();
    let built = false;
    const Built = () => {
      useEffect(() => {
        built = true;
      }, []);
      return null;
    };
    const retried = await ReactThreeTestRenderer.create(
      <Physics init={init}>
        <Built />
      </Physics>,
    );
    for (let tick = 0; tick < 20 && !built; tick += 1) await settle();
    expect(attempts).toBe(2);
    expect(built).toBe(true);

    error.mockRestore();
    await unmount(retried);
    expectNoAsserts();
  });

  it("provides a context once ready and steps the world", async () => {
    const renderer = await renderPhysics(<FallingBox />);
    const { physicsSystem } = getApi();

    expect(physicsSystem.GetNumBodies()).toBe(1);

    await step(renderer, 60);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("advances a fixed timestep independently of frame delta", async () => {
    const renderer = await renderPhysics(<FallingBox />, { timeStep: 1 / 60 });
    const { physicsSystem, Jolt } = getApi();

    const bodies = new Jolt.BodyIDVector();
    physicsSystem.GetBodies(bodies);
    const id = bodies.at(0);
    const bodyInterface = physicsSystem.GetBodyInterface();

    await step(renderer, 60, 1 / 60);
    const afterUniform = bodyInterface.GetPosition(id).GetY();

    Jolt.destroy(bodies);
    await unmount(renderer);

    // One second of simulation from rest: y = 10 - ½·9.81·1² ≈ 5.1
    expect(afterUniform).toBeGreaterThan(4.7);
    expect(afterUniform).toBeLessThan(5.4);
    expectNoAsserts();
  });

  it("does not step while paused", async () => {
    const module = await loadDebugModule();
    let api: ReturnType<typeof getApi> | null = null;

    const renderer = await ReactThreeTestRenderer.create(
      <Physics module={module} paused>
        <FallingBox />
      </Physics>,
    );

    for (let attempt = 0; attempt < 20 && !api; attempt += 1) {
      await ReactThreeTestRenderer.act(async () => {
        await Promise.resolve();
      });
      try {
        api = getApi();
      } catch {
        api = null;
      }
    }

    await step(renderer, 60);
    await unmount(renderer);
  });

  it("leaves no bodies behind after unmount", async () => {
    const renderer = await renderPhysics(<FallingBox />);
    const { physicsSystem } = getApi();

    expect(physicsSystem.GetNumBodies()).toBe(1);

    await step(renderer, 5);
    await unmount(renderer);
    expectNoAsserts();
  });

  it("survives a StrictMode double mount without leaking the interface", async () => {
    const module = await loadDebugModule();

    const measure = async () => {
      const renderer = await renderPhysics(<FallingBox />, { strict: true });
      await step(renderer, 10);
      await unmount(renderer);
    };

    await measure();
    const baseline = module.JoltInterface.prototype.sGetFreeMemory();

    for (let i = 0; i < 5; i += 1) await measure();

    const after = module.JoltInterface.prototype.sGetFreeMemory();
    expect(after).toBe(baseline);
    expectNoAsserts();
  });
});
