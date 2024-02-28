# Jolt Physics Hooks for React-Three-Fiber

[![Version](https://img.shields.io/npm/v/r3f-jolt?style=flat)](https://www.npmjs.com/package/r3f-jolt)
[![Downloads](https://img.shields.io/npm/dt/r3f-jolt.svg?style=flat)](https://www.npmjs.com/package/r3f-jolt)

```bash
npm install r3f-jolt
```

You can find a very basic usage example [`here`](https://github.com/sajal353/r3f-jolt/blob/main/src/Scene.tsx).

## `Physics`

A memoized component for managing physics within a React application.

#### Props

- `gravity`: Optional gravity vector [x, y, z].
- `children`: Physics world items.

#### Returns

A memoized JSX element or `null`.

## `useJolt`

A hook for accessing Jolt Physics components and interfaces.

#### Returns

An object containing the Jolt Physics library, Jolt interface, physics system, body interface, and predefined layers.

## `useBox`

A hook for creating a static or dynamic box-shaped physics body.

#### Parameters

- `size`: The size of the box [width, height, depth].
- `position`: The initial position of the box [x, y, z].
- `rotation`: The initial rotation of the box as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the box (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useCapsule`

A hook for creating a static or dynamic capsule-shaped physics body.

#### Parameters

- `height`: The height of the capsule.
- `radius`: The radius of the capsule.
- `position`: The initial position of the capsule [x, y, z].
- `rotation`: The initial rotation of the capsule as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the capsule (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and capsule shape.

## `useCharacter`

A hook for creating a physics-enabled character.

#### Parameters

- `options`: Configuration options for the character.
- `position`: The initial position of the character [x, y, z].
- `rotation`: The initial rotation of the character as a quaternion [x, y, z, w].
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the character (optional).

#### Returns

An object containing the Jolt character, an update function, and a debug mesh.

## `useCompound`

A hook for creating a compound physics body composed of multiple shapes.

#### Parameters

- `shapes`: An array of shape configurations.
- `position`: The initial position of the compound body [x, y, z].
- `rotation`: The initial rotation of the compound body as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the compound body (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body and shape, and the geometry of the compound body.

## `useConvex`

A hook for creating a physics-enabled convex shape.

#### Parameters

- `vertices`: An array of vertex positions.
- `position`: The initial position of the convex shape [x, y, z].
- `rotation`: The initial rotation of the convex shape as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the convex shape (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body and shape, and the geometry of the convex shape.

## `useCylinder`

A hook for creating a static or dynamic cylinder-shaped physics body.

#### Parameters

- `height`: The height of the cylinder.
- `radius`: The radius of the cylinder.
- `position`: The initial position of the cylinder [x, y, z].
- `rotation`: The initial rotation of the cylinder as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the cylinder (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and cylinder shape.

## `useSphere`

A hook for creating a static or dynamic sphere-shaped physics body.

#### Parameters

- `radius`: The radius of the sphere.
- `position`: The initial position of the sphere [x, y, z].
- `rotation`: The initial rotation of the sphere as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the sphere (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and sphere shape.

## `useTaperedCapsule`

A hook for creating a static or dynamic tapered capsule-shaped physics body.

#### Parameters

- `topRadius`: The top radius of the tapered capsule.
- `bottomRadius`: The bottom radius of the tapered capsule.
- `height`: The height of the tapered capsule.
- `position`: The initial position of the tapered capsule [x, y, z].
- `rotation`: The initial rotation of the tapered capsule as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the tapered capsule (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body, tapered capsule shape, and the geometry of the tapered capsule.

## `useTrimesh`

A hook for creating a physics-enabled trimesh.

#### Parameters

- `mesh`: Object containing position and index data for the trimesh.
- `position`: The initial position of the trimesh [x, y, z].
- `debug`: Enable debugging visualization (optional).
- `material`: Material properties for friction and restitution (optional).
- `bodySettingsOverride`: A function to override Jolt body creation settings (optional).

#### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body, trimesh shape, and the geometry of the trimesh.
