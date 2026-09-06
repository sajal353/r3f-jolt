import { useEffect, useState } from "react";

/**
 * A heightmap decoded to the square grid `useHeightField` wants. `drawImage`
 * with an explicit destination size is a filtered downscale, so an image at any
 * resolution resamples cleanly rather than aliasing into noise.
 */
export const decodeHeightmap = async (url: string, samples: number) => {
  const image = new Image();
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = samples;
  canvas.height = samples;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2d canvas is unavailable");

  context.drawImage(image, 0, 0, samples, samples);

  return context.getImageData(0, 0, samples, samples);
};

/**
 * One in-flight promise per level, kept for the session, so returning to a level
 * already visited costs nothing and the loading state means "never asked for"
 * rather than being a spinner on every toggle.
 */
const cache = new Map<string, Promise<ImageData>>();

const keyOf = (url: string, samples: number) => `${url}@${samples}`;

export const loadHeightmap = (url: string, samples: number) => {
  const key = keyOf(url, samples);
  let pending = cache.get(key);

  if (!pending) {
    pending = decodeHeightmap(url, samples);
    cache.set(key, pending);
  }

  return pending;
};

export interface HeightmapState {
  data: ImageData | null;
  /** True while a level is being fetched and decoded for the first time. */
  loading: boolean;
  error: string | null;
}

interface Resolved {
  key: string;
  data: ImageData | null;
  error: string | null;
}

/**
 * `url` may be `null`, for terrain that is generated rather than loaded.
 *
 * State is only written from the promise's callback, never synchronously in the
 * effect. "Loading" is instead derived from the resolved key not being the
 * requested one — which needs no render, so a level switch can never hand the
 * previous level's data to the new one.
 */
export const useHeightmap = (
  url: string | null,
  samples: number,
): HeightmapState => {
  const key = url ? keyOf(url, samples) : "";
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    loadHeightmap(url, samples).then(
      (data) => {
        if (!cancelled) setResolved({ key, data, error: null });
      },
      (reason: unknown) => {
        if (!cancelled) setResolved({ key, data: null, error: String(reason) });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url, samples, key]);

  const current = resolved?.key === key ? resolved : null;

  return {
    data: current?.data ?? null,
    loading: Boolean(url) && !current,
    error: current?.error ?? null,
  };
};
