import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { DoubleSide, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from "three";
import { useFrame } from "@react-three/fiber";
import { useJolt } from "@/Jolt/useJolt";
import type { Vec3Tuple } from "@/Jolt/types";
import { waveHeightGLSL } from "./waves";

const RIPPLES = 24;

/** A strip along z where the water flows at `speed`, marked with faint lines. */
export interface SurfaceCurrent {
  fromX: number;
  toX: number;
  speed: number;
}

export interface WaterSurfaceHandle {
  /** A ring spreading from `x, z`; `strength` around 1 for a body dropped in. */
  splash: (x: number, z: number, strength: number) => void;
}

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec4 uRipples[${RIPPLES}];

varying vec3 vNormal;
varying vec3 vWorld;

${waveHeightGLSL}

float rippleHeight(vec2 p) {
  float height = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 ripple = uRipples[i];
    float age = uTime - ripple.z;
    if (ripple.w <= 0.0 || age < 0.0 || age > 3.0) continue;
    float behind = distance(p, ripple.xy) - (0.3 + age * 1.8);
    float envelope = exp(-behind * behind * 2.5) * exp(-age * 1.3) * ripple.w;
    height += envelope * 0.08 * sin(behind * 8.0);
  }
  return height;
}

float surfaceHeight(vec2 p) {
  return waveHeight(p, uTime) + rippleHeight(p);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p = world.xz;

  float height = surfaceHeight(p);

  float across = 0.05;
  float slopeX = (surfaceHeight(p + vec2(across, 0.0)) - height) / across;
  float slopeZ = (surfaceHeight(p + vec2(0.0, across)) - height) / across;
  vNormal = normalize(vec3(-slopeX, 1.0, -slopeZ));

  world.y += height;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * One colour, lit by the sun so the waves read by their shading alone. A
 * current shows as faint dashes of the same colour drifting with it.
 */
const fragmentShader = /* glsl */ `
#include <common>

uniform float uTime;
uniform vec3 uSun;
uniform vec4 uCurrent;

varying vec3 vNormal;
varying vec3 vWorld;

float currentLines(vec2 p) {
  if (uCurrent.w <= 0.0 || p.x < uCurrent.x || p.x > uCurrent.y) return 0.0;

  float lanes = p.x * 1.6;
  float lane = floor(lanes);
  float across = abs(fract(lanes) - 0.5);
  float along = fract((p.y + uTime * uCurrent.z) * 0.3 + fract(sin(lane * 12.9898) * 43758.5453));
  float edge = min(p.x - uCurrent.x, uCurrent.y - p.x);

  return (1.0 - smoothstep(0.02, 0.05, across))
    * smoothstep(0.0, 0.1, along) * (1.0 - smoothstep(0.35, 0.5, along))
    * smoothstep(0.0, 0.4, edge);
}

void main() {
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;

  float light = 0.55 + 0.45 * max(dot(normal, uSun), 0.0);
  float line = currentLines(vWorld.xz);
  vec3 color = vec3(0.06, 0.32, 0.42) * light * (1.0 + 0.3 * line);

  gl_FragColor = vec4(color, 0.4 + 0.08 * line);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The water's surface, waved by the same function the physics floats bodies
 * on, plus rings from `splash`. Draw it at the volume's mean surface level.
 */
export const WaterSurface = ({
  position,
  size: [width, length],
  current,
  ref,
}: {
  position: Vec3Tuple;
  size: [number, number];
  current?: SurfaceCurrent;
  ref?: Ref<WaterSurfaceHandle>;
}) => {
  const { timing } = useJolt();
  const material = useRef<ShaderMaterial>(null);
  const next = useRef(0);

  const geometry = useMemo(
    function buildSurface() {
      const plane = new PlaneGeometry(
        width,
        length,
        Math.round(width * 10),
        Math.round(length * 10),
      );
      return plane.rotateX(-Math.PI / 2);
    },
    [width, length],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSun: { value: new Vector3(10, 20, 10).normalize() },
      uRipples: {
        // Strength 0 is an empty slot; a bare `Vector4()` has w = 1.
        value: Array.from({ length: RIPPLES }, () => new Vector4(0, 0, 0, 0)),
      },
      uCurrent: {
        value: current
          ? new Vector4(current.fromX, current.toX, current.speed, 1)
          : new Vector4(),
      },
    }),
    [current],
  );

  const now = () =>
    timing.interpolate
      ? timing.elapsed - (1 - timing.alpha) * timing.stepDelta
      : timing.elapsed;

  useImperativeHandle(ref, () => ({
    splash: (x, z, strength) => {
      const ripples = material.current?.uniforms.uRipples.value as
        | Vector4[]
        | undefined;
      if (!ripples) return;
      ripples[next.current].set(x, z, now(), strength);
      next.current = (next.current + 1) % RIPPLES;
    },
  }));

  useFrame(function advance() {
    if (material.current) material.current.uniforms.uTime.value = now();
  });

  return (
    <mesh position={position} geometry={geometry} renderOrder={1}>
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
};
