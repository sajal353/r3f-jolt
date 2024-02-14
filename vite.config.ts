import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), dts(), tsconfigPaths()],
  build: {
    lib: {
      entry: "lib/main.ts",
      name: "r3f-jolt",
      formats: ["es", "umd"],
      fileName: "r3f-jolt",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
});
