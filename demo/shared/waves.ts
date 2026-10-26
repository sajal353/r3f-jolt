import type { WaveHeight } from "@/Jolt/types";

interface Wave {
  /** Direction of travel across the water, x then z. */
  direction: [number, number];
  length: number;
  amplitude: number;
  phase: number;
}

const GRAVITY = 9.81;

const SOURCES: Wave[] = [
  { direction: [1, 0.3], length: 6, amplitude: 0.07, phase: 0 },
  { direction: [-0.4, 1], length: 3.5, amplitude: 0.045, phase: 1.7 },
  { direction: [0.8, -0.7], length: 2.2, amplitude: 0.025, phase: 4.1 },
  { direction: [-1, -0.2], length: 1.3, amplitude: 0.012, phase: 2.6 },
];

/** Deep water: each wave's speed follows from its length. */
const WAVES = SOURCES.map(function settle({ direction, length, amplitude, phase }) {
  const size = Math.hypot(direction[0], direction[1]);
  const number = (2 * Math.PI) / length;
  return {
    x: direction[0] / size,
    z: direction[1] / size,
    number,
    frequency: Math.sqrt(GRAVITY * number),
    amplitude,
    phase,
  };
});

/** What `<WaterVolume waves>` floats bodies on. */
export const waveHeight: WaveHeight = (x, z, time) => {
  let height = 0;
  for (const wave of WAVES) {
    height +=
      wave.amplitude *
      Math.sin(
        wave.number * (wave.x * x + wave.z * z) -
          wave.frequency * time +
          wave.phase,
      );
  }
  return height;
};

const literal = (value: number) => value.toFixed(6);

/** The same sum in GLSL, so what is drawn is what bodies float on. */
export const waveHeightGLSL = `
float waveHeight(vec2 p, float time) {
  float height = 0.0;
${WAVES.map(
  (wave) =>
    `  height += ${literal(wave.amplitude)} * sin(${literal(wave.number)} * ` +
    `(${literal(wave.x)} * p.x + ${literal(wave.z)} * p.y) - ` +
    `${literal(wave.frequency)} * time + ${literal(wave.phase)});`,
).join("\n")}
  return height;
}
`;

/** Tallest crest above the mean level. */
export const WAVE_CREST = WAVES.reduce((sum, wave) => sum + wave.amplitude, 0);
