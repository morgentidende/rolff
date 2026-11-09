import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], base: "./", build: { rollupOptions: { input: { main: "index.html", tjek: "tjek.html", composer: "composer-fixture.html", messageActions: "message-actions-fixture.html" } } } });
