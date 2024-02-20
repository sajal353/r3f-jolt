# Jolt Physics Hooks for React-Three-Fiber

[Example](https://github.com/sajal353/r3f-jolt/blob/main/src/Scene.tsx)

## `Physics`

A memoized component for managing physics within a React application.

### Props

- `gravity`: Optional gravity vector [x, y, z].
- `children`: Physics world items.

### Returns

A memoized JSX element or `null`.

## `useBox`

A hook for creating a static or dynamic box-shaped physics body.

### Parameters

- `size`: The size of the box [width, height, depth].
- `position`: The initial position of the box [x, y, z].
- `rotation`: The initial rotation of the box as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the box (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useCapsule`

A hook for creating a static or dynamic capsule-shaped physics body.

### Parameters

- `height`: The height of the capsule.
- `radius`: The radius of the capsule.
- `position`: The initial position of the capsule [x, y, z].
- `rotation`: The initial rotation of the capsule as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the capsule (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useCharacter`

A hook for creating a character with physics properties.

### Parameters

- `options`: Object containing character options.
- `position`: The initial position of the character [x, y, z].
- `rotation`: The initial rotation of the character as a quaternion [x, y, z, w].
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the character (optional).

### Returns

An object containing the character, an update function, and a debug mesh.

## `useCompound`

A hook for creating a compound physics body composed of multiple shapes.

### Parameters

- `shapes`: Array of shape definitions.
- `position`: The initial position of the compound shape [x, y, z].
- `rotation`: The initial rotation of the compound shape as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The total mass of the compound shape (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body and shape, and the Three.js geometry.

## `useConvex`

A hook for creating a static or dynamic convex-shaped physics body.

### Parameters

- `vertices`: Array of vertices defining the convex shape.
- `position`: The initial position of the convex shape [x, y, z].
- `rotation`: The initial rotation of the convex shape as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the convex shape (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useCylinder`

A hook for creating a static or dynamic cylinder-shaped physics body.

### Parameters

- `height`: The height of the cylinder.
- `radius`: The radius of the cylinder.
- `position`: The initial position of the cylinder [x, y, z].
- `rotation`: The initial rotation of the cylinder as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the cylinder (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useJolt`

A hook providing access to various elements of the Jolt physics library.

### Returns

An object containing Jolt library elements such as Jolt, joltInterface, physicsSystem, bodyInterface, and layers.

## `useSphere`

A hook for creating a static or dynamic sphere-shaped physics body.

### Parameters

- `radius`: The radius of the sphere.
- `position`: The initial position of the sphere [x, y, z].
- `rotation`: The initial rotation of the sphere as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the sphere (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh and the associated Jolt physics body and shape.

## `useTaperedCapsule`

A hook for creating a static or dynamic tapered capsule-shaped physics body.

### Parameters

- `topRadius`: The top radius of the tapered capsule.
- `bottomRadius`: The bottom radius of the tapered capsule.
- `height`: The height of the tapered capsule.
- `position`: The initial position of the tapered capsule [x, y, z].
- `rotation`: The initial rotation of the tapered capsule as a quaternion [x, y, z, w].
- `motionType`: The type of motion, either "static" or "dynamic".
- `debug`: Enable debugging visualization (optional).
- `mass`: The mass of the tapered capsule (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body and shape, and the Three.js geometry.

## `useTrimesh`

A hook for creating a static or dynamic physics body based on a custom mesh.

### Parameters

- `mesh`: Object containing position and index information for the custom mesh.
- `position`: The initial position of the custom mesh [x, y, z].
- `debug`: Enable debugging visualization (optional).
- `material`: Material properties for friction and restitution (optional).

### Returns

A tuple containing a reference to the Three.js mesh, the associated Jolt physics body and shape, and the Three.js geometry.
