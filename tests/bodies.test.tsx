import { describe, expect, it } from "vitest";
import {
  expectNoAsserts,
  getApi,
  loadDebugModule,
  renderPhysics,
  step,
  unmount,
} from "./harness";
import { shapeHooks } from "./fixtures";

describe("body hooks", () => {
  for (const [name, Component] of shapeHooks) {
    it(`${name} adds exactly one body and removes it on unmount`, async () => {
      const renderer = await renderPhysics(<Component />);
      const { physicsSystem } = getApi();

      expect(physicsSystem.GetNumBodies()).toBe(1);

      await step(renderer, 5);
      await unmount(renderer);
      expectNoAsserts();
    });

    it(`${name} does not leak across mount/unmount cycles`, async () => {
      const module = await loadDebugModule();

      const cycle = async () => {
        const renderer = await renderPhysics(<Component />);
        await step(renderer, 3);
        await unmount(renderer);
      };

      await cycle();
      const baseline = module.JoltInterface.prototype.sGetFreeMemory();

      for (let i = 0; i < 5; i += 1) await cycle();

      expect(module.JoltInterface.prototype.sGetFreeMemory()).toBe(baseline);
      expectNoAsserts();
    });
  }

  it("mounts every shape together and tears them all down", async () => {
    const All = () => (
      <>
        {shapeHooks.map(([name, Component]) => (
          <Component key={name} />
        ))}
      </>
    );

    const renderer = await renderPhysics(<All />);
    expect(getApi().physicsSystem.GetNumBodies()).toBe(shapeHooks.length);

    await step(renderer, 10);
    await unmount(renderer);
    expectNoAsserts();
  });
});
