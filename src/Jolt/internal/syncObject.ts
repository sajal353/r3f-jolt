import type { Object3D } from "three";
import type Jolt from "jolt-physics";

export const syncObject = (object: Object3D, body: Jolt.Body) => {
  const position = body.GetPosition();
  object.position.set(position.GetX(), position.GetY(), position.GetZ());

  const rotation = body.GetRotation();
  object.quaternion.set(
    rotation.GetX(),
    rotation.GetY(),
    rotation.GetZ(),
    rotation.GetW(),
  );
};
