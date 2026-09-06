import { useEffect, useState } from "react";
import { Vector3 } from "three";
import type Jolt from "jolt-physics";
import { useJolt } from "./useJolt";
import { useHandlerRef } from "./internal/useHandlerRef";
import type { BodyApi } from "./internal/useBody";
import type { Vec3Input } from "./types";

export interface UseConveyorOptions {
  linear?: Vec3Input;
  angular?: Vec3Input;
  space?: "local" | "world";
  /** A sleeping body reports no contacts at all, so it never notices the belt
   *  started. On by default. */
  wake?: boolean;
}

export interface ConveyorApi {
  setLinear: (velocity: Vec3Input) => void;
  setAngular: (velocity: Vec3Input) => void;
  stop: () => void;
}

const WAKE_MARGIN = 0.05;

const readInto = (target: Vector3, value: Vec3Input | undefined) => {
  if (!value) return target.set(0, 0, 0);

  return Array.isArray(value)
    ? target.set(value[0], value[1], value[2])
    : target.set(value.x, value.y, value.z);
};

/**
 * Friction does the dragging, so a belt with `friction: 0` carries nothing. A
 * `useCharacter` is never carried: `CharacterVirtual` runs its own contact
 * listener, and Jolt's character contact settings have no surface-velocity field.
 */
export const useConveyor = <S extends Jolt.Shape>(
  api: BodyApi<S> | undefined,
  options: UseConveyorOptions = {},
): ConveyorApi | undefined => {
  const jolt = useJolt();
  const [conveyor, setConveyor] = useState<ConveyorApi>();

  const optionsRef = useHandlerRef(options);

  useEffect(() => {
    if (!api) return;

    const {
      linear,
      angular,
      space = "local",
      wake = true,
    } = optionsRef.current;

    const handle = jolt.contacts.addSurfaceVelocity(
      api.body.GetID().GetIndexAndSequenceNumber(),
      {
        linear: readInto(new Vector3(), linear),
        angular: readInto(new Vector3(), angular),
        space,
      },
    );

    const record = handle.source;

    const bounds = new jolt.Jolt.AABox();
    const margin = new jolt.Jolt.Vec3(WAKE_MARGIN, WAKE_MARGIN, WAKE_MARGIN);
    const layer = api.body.GetObjectLayer();

    const broadPhaseFilter = new jolt.Jolt.DefaultBroadPhaseLayerFilter(
      jolt.joltInterface.GetObjectVsBroadPhaseLayerFilter(),
      layer,
    );
    const objectFilter = new jolt.Jolt.DefaultObjectLayerFilter(
      jolt.joltInterface.GetObjectLayerPairFilter(),
      layer,
    );

    const wakeSleepers = () => {
      if (!wake) return;
      if (jolt.state.disposed) return;
      if (record.linear.lengthSq() === 0 && record.angular.lengthSq() === 0) {
        return;
      }

      bounds.EncapsulateAABox(api.body.GetWorldSpaceBounds());
      bounds.ExpandBy(margin);
      jolt.bodyInterface.ActivateBodiesInAABox(
        bounds,
        broadPhaseFilter,
        objectFilter,
      );
      bounds.SetEmpty();
    };

    setConveyor({
      setLinear: (velocity) => {
        readInto(record.linear, velocity);
        wakeSleepers();
      },
      setAngular: (velocity) => {
        readInto(record.angular, velocity);
        wakeSleepers();
      },
      stop: () => {
        record.linear.set(0, 0, 0);
        record.angular.set(0, 0, 0);
      },
    });

    wakeSleepers();

    return () => {
      setConveyor(undefined);
      handle.release();

      // The interface owns the heap these came from, so once it is gone there
      // is nothing left to free and the free itself would be a use-after-free.
      if (jolt.state.destroyed) return;

      jolt.Jolt.destroy(objectFilter);
      jolt.Jolt.destroy(broadPhaseFilter);
      jolt.Jolt.destroy(margin);
      jolt.Jolt.destroy(bounds);
    };
  }, [api, jolt, optionsRef]);

  return conveyor;
};
