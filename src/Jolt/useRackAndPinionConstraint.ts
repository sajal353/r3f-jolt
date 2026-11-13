import { useEffect } from "react";
import type Jolt from "jolt-physics";
import {
  useConstraint,
  type ConstraintApi,
  type ConstraintBody,
  type ConstraintOptions,
} from "./internal/useConstraint";
import { readRackLoad } from "./internal/constraintLoad";
import {
  resolveSpace,
  type ConstraintSpace,
} from "./internal/constraintSettings";
import type { HingeConstraintApi } from "./useHingeConstraint";
import type { SliderConstraintApi } from "./useSliderConstraint";
import type { JoltModule, Temps, Vec3Tuple } from "./types";

export interface UseRackAndPinionConstraintOptions extends ConstraintOptions {
  space?: ConstraintSpace;
  /** The axis the pinion turns about. */
  hingeAxis?: Vec3Tuple;
  /** The axis the rack slides along. */
  sliderAxis?: Vec3Tuple;
  /** Teeth on the pinion and on a `length` of rack, in metres. */
  teeth?: { pinion: number; rack: number; length: number };
  /** In place of `teeth`: the pinion's radians per metre of rack. */
  ratio?: number;
  /**
   * The hinge holding the pinion and the slider holding the rack. Without them
   * the joint only ties their speeds, so they slowly slip out of step.
   */
  hinge?: HingeConstraintApi;
  slider?: SliderConstraintApi;
}

export type RackAndPinionConstraintApi =
  ConstraintApi<Jolt.RackAndPinionConstraint>;

const buildSettings = (
  jolt: JoltModule,
  temps: Temps,
  options: UseRackAndPinionConstraintOptions,
) => {
  const settings = new jolt.RackAndPinionConstraintSettings();

  settings.mSpace = resolveSpace(jolt, options.space);
  if (options.hingeAxis) settings.mHingeAxis = temps.vec3(options.hingeAxis);
  if (options.sliderAxis) settings.mSliderAxis = temps.vec3(options.sliderAxis);

  if (options.teeth) {
    const { rack, length, pinion } = options.teeth;
    settings.SetRatio(rack, length, pinion);
  } else if (options.ratio !== undefined) {
    settings.mRatio = options.ratio;
  }

  return settings;
};

const castRack = (constraint: Jolt.TwoBodyConstraint, jolt: JoltModule) =>
  jolt.castObject(constraint, jolt.RackAndPinionConstraint);

/**
 * Turns a pinion's rotation into a rack's travel, each on a joint of its own: a
 * hinge for body 1, the pinion, and a slider for body 2, the rack.
 */
export const useRackAndPinionConstraint = (
  pinion: ConstraintBody | undefined,
  rack: ConstraintBody | undefined,
  options: UseRackAndPinionConstraintOptions,
) => {
  const result = useConstraint<Jolt.RackAndPinionConstraint>(
    pinion,
    rack,
    options,
    {
      hook: "useRackAndPinionConstraint",
      settings: (jolt, temps) => buildSettings(jolt, temps, options),
      cast: castRack,
      load: readRackLoad,
    },
  );

  const [joint] = result;
  const { hinge, slider } = options;

  useEffect(() => {
    if (joint && hinge && slider) {
      joint.constraint.SetConstraints(hinge.constraint, slider.constraint);
    }
  }, [joint, hinge, slider]);

  return result;
};
