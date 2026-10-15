import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
    allowedHosts: [
      "board.sanshiro.dpdns.org",
      ".sanshiro.dpdns.org",
      "localhost",
      "127.0.0.1",
    ],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "StoryboardEngine",
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
    },
  },
});
