import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:3002",
      "/ws": {
        target: "ws://localhost:3002",
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
