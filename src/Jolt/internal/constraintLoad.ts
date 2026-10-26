import type Jolt from "jolt-physics";
import type { ConstraintLoad } from "./useConstraint";

/**
 * What each joint type reports of the impulses holding it together, folded
 * into one linear and one angular magnitude. Limits count — a door slammed
 * against its stop loads the hinge — but motors do not: a motor is the joint
 * doing work, not resisting it.
 *
 * The parts a type reports act along different axes, so they combine as the
 * length of one vector rather than as a sum.
 */

const length2 = (vector: Jolt.Vector2) =>
  Math.hypot(vector.GetComponent(0), vector.GetComponent(1));

export const readDistanceLoad = (
  constraint: Jolt.DistanceConstraint,
  out: ConstraintLoad,
) => {
  out.force = Math.abs(constraint.GetTotalLambdaPosition());
  out.torque = 0;
};

export const readPointLoad = (
  constraint: Jolt.PointConstraint,
  out: ConstraintLoad,
) => {
  out.force = constraint.GetTotalLambdaPosition().Length();
  out.torque = 0;
};

export const readHingeLoad = (
  constraint: Jolt.HingeConstraint,
  out: ConstraintLoad,
) => {
  out.force = constraint.GetTotalLambdaPosition().Length();
  out.torque = Math.hypot(
    length2(constraint.GetTotalLambdaRotation()),
    constraint.GetTotalLambdaRotationLimits(),
  );
};

export const readSliderLoad = (
  constraint: Jolt.SliderConstraint,
  out: ConstraintLoad,
) => {
  out.force = Math.hypot(
    length2(constraint.GetTotalLambdaPosition()),
    constraint.GetTotalLambdaPositionLimits(),
  );
  out.torque = constraint.GetTotalLambdaRotation().Length();
};

export const readConeLoad = (
  constraint: Jolt.ConeConstraint,
  out: ConstraintLoad,
) => {
  out.force = constraint.GetTotalLambdaPosition().Length();
  out.torque = Math.abs(constraint.GetTotalLambdaRotation());
};

export const readSwingTwistLoad = (
  constraint: Jolt.SwingTwistConstraint,
  out: ConstraintLoad,
) => {
  out.force = constraint.GetTotalLambdaPosition().Length();
  out.torque = Math.hypot(
    constraint.GetTotalLambdaTwist(),
    constraint.GetTotalLambdaSwingY(),
    constraint.GetTotalLambdaSwingZ(),
  );
};

export const readSixDOFLoad = (
  constraint: Jolt.SixDOFConstraint,
  out: ConstraintLoad,
) => {
  out.force = constraint.GetTotalLambdaPosition().Length();
  out.torque = constraint.GetTotalLambdaRotation().Length();
};

/**
 * A joint's load averaged over the last `span` seconds of simulation. An impact
 * delivers about the same impulse whatever the step length, so dividing one
 * step's impulse by that step reads twice the force at 120 Hz that it does at
 * 60, and the same hit would break a joint on one display and not another. Over
 * a fixed span a steady load reads the same as before and an impact reads the
 * same at any step rate.
 *
 * Steps are kept newest last; the oldest one counts only for the part of it
 * that falls inside the span. Until a full span has been seen the missing time
 * counts as unloaded, so a fresh joint ramps up rather than spiking.
 */
export const createLoadWindow = (span: number) => {
  const deltas: number[] = [];
  const forces: number[] = [];
  const torques: number[] = [];
  let covered = 0;

  const dropOldest = () => {
    covered -= deltas.shift() ?? 0;
    forces.shift();
    torques.shift();
  };

  return {
    /** One step's impulses, as a `load` reader reports them. */
    push: (delta: number, impulses: ConstraintLoad) => {
      deltas.push(delta);
      forces.push(impulses.force);
      torques.push(impulses.torque);
      covered += delta;

      while (deltas.length > 1 && covered - deltas[0] >= span) dropOldest();
    },

    /** Newtons and newton-metres. */
    average: (out: ConstraintLoad) => {
      const overhang = Math.max(0, covered - span);
      let force = 0;
      let torque = 0;

      for (let index = 0; index < deltas.length; index += 1) {
        const share = index === 0 ? 1 - overhang / deltas[0] : 1;
        force += forces[index] * share;
        torque += torques[index] * share;
      }

      out.force = force / span;
      out.torque = torque / span;
    },

    clear: () => {
      deltas.length = 0;
      forces.length = 0;
      torques.length = 0;
      covered = 0;
    },
  };
};
