import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  root: "demo",
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
