import type { JoltModule, MotionType } from "../types";

export const resolveMotionType = (jolt: JoltModule, motionType: MotionType) => {
  if (motionType === "dynamic") return jolt.EMotionType_Dynamic;
  if (motionType === "kinematic") return jolt.EMotionType_Kinematic;
  return jolt.EMotionType_Static;
};

export const motionTypeName = (
  jolt: JoltModule,
  motionType: number,
): MotionType => {
  if (motionType === jolt.EMotionType_Dynamic) return "dynamic";
  if (motionType === jolt.EMotionType_Kinematic) return "kinematic";
  return "static";
};
