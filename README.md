# Jolt Physics Hooks for React-Three-Fiber

[![Version](https://img.shields.io/npm/v/r3f-jolt?style=flat)](https://www.npmjs.com/package/r3f-jolt)
[![Downloads](https://img.shields.io/npm/dt/r3f-jolt.svg?style=flat)](https://www.npmjs.com/package/r3f-jolt)

```bash
npm install r3f-jolt
```

You can find a very basic usage example [`here`](https://github.com/sajal353/r3f-jolt/blob/main/src/Scene.tsx).

## `Physics`

A component for setting up the Jolt Physics environment and managing physics simulation.

#### Props

- `gravity` (optional): The gravity vector applied to the physics simulation, specified as an array [x, y, z]. Default is `[0, -9.81, 0]`.
- `children`: React nodes representing the objects in the scene that will be affected by physics simulation.

#### Usage

Wrap your scene with the `Physics` component to enable physics simulation.

## `useJolt`

A hook for accessing Jolt Physics context.

#### Returns

An object containing references to Jolt Physics entities.

- `Jolt`: Reference to the Jolt Physics library.
- `joltInterface`: Instance of `Jolt.JoltInterface` providing access to various Jolt functionalities.
- `physicsSystem`: Instance of `Jolt.PhysicsSystem` representing the physics system.
- `bodyInterface`: Instance of `Jolt.BodyInterface` providing access to body-related functionalities.
- `layers`: An object containing layer constants for categorizing physics bodies.
  - `LAYER_NON_MOVING`: Constant representing the non-moving layer.
  - `LAYER_MOVING`: Constant representing the moving layer.

## `useBox`

A hook for creating a static or dynamic box-shaped physics body.

#### Parameters

- `size`: The dimensions of the box as an array [x, y, z].
- `position`: The initial position of the box in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the box as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the box. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: Reference to the box mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the box shape.
  - `shape`: Instance of `Jolt.BoxShape` representing the shape of the box body.
  - `debugMesh`: Optional mesh for debugging visualization.

## `useCapsule`

A hook for creating a static or dynamic capsule-shaped physics body.

#### Parameters

- `height`: The height of the capsule.
- `radius`: The radius of the capsule.
- `position`: The initial position of the capsule in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the capsule as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the capsule. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: Reference to the capsule mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the capsule shape.
  - `shape`: Instance of `Jolt.Shape` representing the shape of the capsule body.
  - `debugMesh`: Optional mesh for debugging visualization.

## `useCharacter`

A hook for creating a physics-enabled character.

#### Parameters

- `options`: An object containing various options for configuring the character's behavior and physical properties:

  - `height`: Object specifying the height of the character in different states.
    - `standing`: Height of the character while standing.
  - `radius`: Object specifying the radius of the character in different states.
    - `standing`: Radius of the character while standing.
  - `moveDuringJump`: Boolean indicating whether the character can move while jumping.
  - `moveSpeed`: Speed of horizontal movement.
  - `jumpSpeed`: Speed of jumping.
  - `enableInertia`: Boolean indicating whether to enable inertia for smoother movement.
  - `enableStairStep`: Boolean indicating whether the character can step up stairs.
  - `enableStickToFloor`: Boolean indicating whether the character sticks to the floor.

- `position`: Initial position of the character in 3D space, specified as an array [x, y, z].
- `rotation` (optional): Initial rotation of the character as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): Mass of the character. Default is 1000.

#### Returns

`[api]`

- `api`: An object containing the following properties:
  - `character`: Instance of `Jolt.CharacterVirtual` representing the character.
  - `update`: Function to update the character's movement and behavior. Accepts parameters for movement direction, jump, delta time, and an optional override function for custom velocity updates.
  - `debugMesh`: Optional mesh for debugging visualization.

## `useCompound`

A hook for creating a compound physics body composed of multiple shapes.

#### Parameters

- `shapes`: An array of objects, each defining a shape within the compound body. Each shape object has the following properties:
  - `type`: The type of shape, which can be one of: "box", "capsule", "cylinder", "sphere", "taperedCapsule", or "convex".
  - `position`: The position of the shape within the compound body, specified as an array [x, y, z].
  - `rotation` (optional): The rotation of the shape as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
  - Additional properties depending on the shape type:
    - For "box": `size` - The size of the box as an array [width, height, depth].
    - For "capsule": `height` - The height of the capsule, and `radius` - The radius of the capsule.
    - For "cylinder": `height` - The height of the cylinder, and `radius` - The radius of the cylinder.
    - For "sphere": `radius` - The radius of the sphere.
    - For "taperedCapsule": `height`, `topRadius`, and `bottomRadius`.
    - For "convex": `vertices` - An array of vertices defining the shape of the convex body. Each vertex is specified as an array [x, y, z].
- `position`: The initial position of the compound body in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the compound body as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the compound body. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the compound shape.
  - `shape`: Instance of `Jolt.Shape` representing the shape of the compound body.
  - `debugMesh`: Optional mesh for debugging visualization.
  - `geometry`: BufferGeometry representing the geometry of the compound body.

## `useConvex`

A hook for creating a physics-enabled convex shape.

#### Parameters

- `vertices`: An array of vertices defining the shape of the convex body. Each vertex is specified as an array [x, y, z].
- `position`: The initial position of the convex body in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the convex body as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the convex body. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the convex shape.
  - `shape`: Instance of `Jolt.Shape` representing the shape of the convex body.
  - `debugMesh`: Optional mesh for debugging visualization.
  - `geometry`: BufferGeometry representing the geometry of the convex body.

## `useCylinder`

A hook for creating a static or dynamic cylinder-shaped physics body.

#### Parameters

- `height`: The height of the cylinder.
- `radius`: The radius of the cylinder.
- `position`: The initial position of the cylinder in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the cylinder as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the cylinder. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the cylinder.
  - `shape`: Instance of `Jolt.CylinderShape` representing the shape of the cylinder.
  - `debugMesh`: Optional mesh for debugging visualization.

## `useSphere`

A hook for creating a static or dynamic sphere-shaped physics body.

#### Parameters

- `radius`: The radius of the sphere.
- `position`: The initial position of the sphere in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the sphere as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the sphere. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the sphere.
  - `shape`: Instance of `Jolt.SphereShape` representing the shape of the sphere.
  - `debugMesh`: Optional mesh for debugging visualization.

## `useTaperedCapsule`

A hook for creating a static or dynamic tapered capsule-shaped physics body.

#### Parameters

- `topRadius`: The top radius of the tapered capsule.
- `bottomRadius`: The bottom radius of the tapered capsule.
- `height`: The height of the tapered capsule.
- `position`: The initial position of the tapered capsule in 3D space, specified as an array [x, y, z].
- `rotation` (optional): The initial rotation of the tapered capsule as a quaternion, specified as an array [x, y, z, w]. Default is [0, 0, 0, 1].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug` (optional): Enable debugging visualization. Default is `false`.
- `mass` (optional): The mass of the tapered capsule. Default is 1000.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the tapered capsule.
  - `shape`: Instance of `Jolt.Shape` representing the shape of the tapered capsule.
  - `debugMesh`: Optional mesh for debugging visualization.
  - `geometry`: Buffer geometry representing the geometry of the tapered capsule.

## `useTrimesh`

A hook for creating a physics-enabled trimesh.

#### Parameters

- `mesh`: An object containing position and index data for the trimesh.
  - `position`: Buffer attribute or interleaved buffer attribute representing the vertices' positions.
  - `index`: Typed array representing the indices of the trimesh.
- `position`: The initial position of the trimesh in 3D space, specified as an array [x, y, z].
- `debug` (optional): A boolean indicating whether to enable debugging visualization. Default is `false`.
- `material` (optional): Material properties for friction and restitution.
  - `friction`: Friction coefficient.
  - `restitution`: Restitution coefficient.
- `bodySettingsOverride` (optional): A function to override Jolt body creation settings.

#### Returns

`[ref, api]`

- `ref`: React ref object for accessing the Three.js mesh.
- `api`: An object containing the following properties:
  - `body`: Instance of `Jolt.Body` representing the physics body of the trimesh.
  - `shape`: Instance of `Jolt.Shape` representing the shape of the trimesh.
  - `debugMesh`: Optional mesh for debugging visualization.
  - `geometry`: Buffer geometry representing the geometry of the trimesh.

## `useClosestHitRaycaster`

A hook for casting a ray and detecting the closest hit collision.

#### Parameters

- `origin`: The origin point of the ray in 3D space, specified as an array [x, y, z].
- `direction`: The direction vector of the ray, specified as an array [x, y, z].

#### Returns

`[api]`

- `api`: An object containing the following properties:
  - `ray`: An instance of `Jolt.RRayCast`, representing the ray used for casting.
  - `cast`: A function that accepts an optional `origin` parameter (a Three.js `Vector3` instance) and casts the ray from that origin. It returns an object with the following properties:
    - `collector`: An instance of `Jolt.CastRayClosestHitCollisionCollector`, collecting collision data.
    - `distance`: The distance to the closest hit.
    - `hit`: A boolean indicating whether a hit occurred.
