import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import { dependencies, peerDependencies } from "./package.json";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dts({
      rollupTypes: true,
    }),
    tsconfigPaths(),
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry: "lib/main.ts",
      name: "r3f-jolt",
      formats: ["es"],
      fileName: "r3f-jolt",
    },
    rollupOptions: {
      external: [
        ...Object.keys(dependencies),
        ...Object.keys(peerDependencies),
      ],
    },
  },
});
