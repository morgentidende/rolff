import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// One id per build. The app compares it with /version.json to detect a newer deploy.
const build = process.env.ROLFF_BUILD_ID || `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
const versionFile = (): Plugin => ({ name: "rolff-version", apply: "build", generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build }) + "\n" }); } });
export default defineConfig({ plugins: [react(), versionFile()], define: { __ROLFF_BUILD__: JSON.stringify(build) }, base: "./", build: { rollupOptions: { input: { main: "index.html", tjek: "tjek.html", composer: "composer-fixture.html", messageActions: "message-actions-fixture.html" } } } });
