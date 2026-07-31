import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import { peerDependencies } from "./package.json";

export default defineConfig({
  plugins: [
    react(),
    dts({
      bundleTypes: true,
      tsconfigPath: "./tsconfig.lib.json",
    }),
    tsconfigPaths(),
  ],
  build: {
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "lib/main.ts",
      name: "r3f-jolt",
      formats: ["es"],
      fileName: "r3f-jolt",
    },
    rollupOptions: {
      external: [
        ...Object.keys(peerDependencies),
        /^jolt-physics(\/.*)?$/,
        "react/jsx-runtime",
      ],
    },
  },
});
