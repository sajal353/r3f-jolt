import { Quaternion, Vector3, type Object3D } from "three";
import type Jolt from "jolt-physics";
import type { PhysicsTiming } from "../types";

/**
 * Renders a body between the last two physics steps rather than snapping to the
 * newest one. A fixed timestep almost never lines up with the display's refresh,
 * so without this a body advances on some frames and not others — visible as
 * judder even though the simulation is perfectly smooth.
 *
 * The cost is one step of latency: what you see is the world as it was up to
 * `timeStep` seconds ago.
 */
export const createTransformTracker = () => {
  const previousPosition = new Vector3();
  const currentPosition = new Vector3();
  const previousRotation = new Quaternion();
  const currentRotation = new Quaternion();

  const position = new Vector3();
  const rotation = new Quaternion();

  let lastStepCount = -1;
  let primed = false;

  const readBody = (body: Jolt.Body) => {
    const bodyPosition = body.GetPosition();
    currentPosition.set(
      bodyPosition.GetX(),
      bodyPosition.GetY(),
      bodyPosition.GetZ(),
    );

    const bodyRotation = body.GetRotation();
    currentRotation.set(
      bodyRotation.GetX(),
      bodyRotation.GetY(),
      bodyRotation.GetZ(),
      bodyRotation.GetW(),
    );
  };

  const snap = () => {
    previousPosition.copy(currentPosition);
    previousRotation.copy(currentRotation);
  };

  return {
    update: (body: Jolt.Body, timing: PhysicsTiming) => {
      if (!timing.interpolate) {
        readBody(body);
        position.copy(currentPosition);
        rotation.copy(currentRotation);
        return;
      }

      if (!primed) {
        readBody(body);
        snap();
        primed = true;
        lastStepCount = timing.stepCount;
      } else if (timing.stepCount !== lastStepCount) {
        // Only shift on a frame that actually stepped. Shifting every frame
        // would collapse previous onto current and defeat the interpolation.
        snap();
        readBody(body);
        lastStepCount = timing.stepCount;
      }

      position.lerpVectors(previousPosition, currentPosition, timing.alpha);
      rotation.slerpQuaternions(
        previousRotation,
        currentRotation,
        timing.alpha,
      );
    },

    applyTo: (object: Object3D) => {
      object.position.copy(position);
      object.quaternion.copy(rotation);
    },

    /**
     * Forget the history. Without this a teleported body visibly slides in from
     * wherever it used to be over the next step.
     */
    reset: () => {
      primed = false;
    },
  };
};

export type TransformTracker = ReturnType<typeof createTransformTracker>;
