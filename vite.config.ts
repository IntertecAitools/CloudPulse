import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET =
  process.env["CLOUDPULSE_API_TARGET"] ?? `http://localhost:${process.env["CLOUDPULSE_PORT"] ?? 8081}`;

export default defineConfig({
  plugins: [
    tailwindcss(),
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    port: 8080,
    // Bind all interfaces, not just localhost: the blackbox exporter probes
    // the dev server from inside Docker via host.docker.internal, and nginx
    // proxies to it the same way. Note this also exposes the dev server on
    // your LAN.
    host: true,
    // Vite's DNS-rebinding guard 403s any Host header it doesn't know. nginx
    // and the blackbox prober both reach the dev server as
    // host.docker.internal, so it has to be allowed explicitly.
    allowedHosts: ["localhost", "host.docker.internal"],
    proxy: {
      // The local nginx from docker-compose.yml, which fronts Grafana and the
      // auth/monitoring services exactly as it does in production.
      // Override to point at a remote box: CLOUDPULSE_API_TARGET=http://<host>
      "/grafana": { target: API_TARGET, changeOrigin: true },
      "/alerts-api": { target: API_TARGET, changeOrigin: true },
      "/dashboards-api": { target: API_TARGET, changeOrigin: true },
      "/auth": { target: API_TARGET, changeOrigin: true },
    },
  },
});