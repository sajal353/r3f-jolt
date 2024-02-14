import { memo, useEffect, useState } from "react";
import { joltContext } from "./context";
import initJolt from "jolt-physics/wasm-compat";
import { useFrame } from "@react-three/fiber";

export const Physics = memo(
  ({
    gravity = [0, -9.81, 0] as [number, number, number],
    children,
  }: {
    gravity?: [number, number, number];
    children: React.ReactNode;
  }) => {
    const [api, setApi] = useState<{
      Jolt: typeof initJolt;
      joltInterface: initJolt.JoltInterface;
      physicsSystem: initJolt.PhysicsSystem;
      bodyInterface: initJolt.BodyInterface;
      layers: {
        LAYER_NON_MOVING: number;
        LAYER_MOVING: number;
      };
    } | null>(null);

    useEffect(() => {
      if (!api) {
        (async () => {
          const LAYER_NON_MOVING = 0;
          const LAYER_MOVING = 1;
          const NUM_OBJECT_LAYERS = 2;

          const Jolt = await initJolt();

          const settings = new Jolt.JoltSettings();
          const objectFilter = new Jolt.ObjectLayerPairFilterTable(
            NUM_OBJECT_LAYERS
          );
          objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING);
          objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
          const BP_LAYER_NON_MOVING = new Jolt.BroadPhaseLayer(0);
          const BP_LAYER_MOVING = new Jolt.BroadPhaseLayer(1);
          const NUM_BROAD_PHASE_LAYERS = 2;
          const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(
            NUM_OBJECT_LAYERS,
            NUM_BROAD_PHASE_LAYERS
          );
          bpInterface.MapObjectToBroadPhaseLayer(
            LAYER_NON_MOVING,
            BP_LAYER_NON_MOVING
          );
          bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_LAYER_MOVING);

          settings.mObjectLayerPairFilter = objectFilter;
          settings.mBroadPhaseLayerInterface = bpInterface;
          settings.mObjectVsBroadPhaseLayerFilter =
            new Jolt.ObjectVsBroadPhaseLayerFilterTable(
              settings.mBroadPhaseLayerInterface,
              NUM_BROAD_PHASE_LAYERS,
              settings.mObjectLayerPairFilter,
              NUM_OBJECT_LAYERS
            );

          const joltInterface = new Jolt.JoltInterface(settings);

          Jolt.destroy(settings);

          const physicsSystem = joltInterface.GetPhysicsSystem();
          const bodyInterface = physicsSystem.GetBodyInterface();

          setApi({
            Jolt,
            joltInterface,
            physicsSystem,
            bodyInterface,
            layers: {
              LAYER_NON_MOVING,
              LAYER_MOVING,
            },
          });
        })();
      }
      return () => {
        if (api) {
          api.Jolt.destroy(api.joltInterface);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gravity]);

    useEffect(() => {
      if (api) {
        api.physicsSystem.SetGravity(
          new api.Jolt.Vec3(gravity[0], gravity[1], gravity[2])
        );
      }
    }, [gravity, api]);

    useFrame((_, delta) => {
      let deltaTime = delta;

      deltaTime = Math.min(deltaTime, 1.0 / 30.0);

      const numSteps = deltaTime > 1.0 / 55.0 ? 2 : 1;

      if (api) {
        api.joltInterface.Step(deltaTime, numSteps);
      }
    });

    if (!api) {
      return null;
    }

    return <joltContext.Provider value={api}>{children}</joltContext.Provider>;
  }
);
