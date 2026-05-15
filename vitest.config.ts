import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

// Point Vite's loadEnv at a folder with no .env files so it doesn't try to
// read `.env.local` (which may have restrictive 600 permissions in dev
// environments owned by a different OS user). Test env vars should be set
// via the shell or vitest's `env` block, not project-root dotenv files.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": resolve(rootDir, "shared"),
    },
  },
  envDir: resolve(rootDir, "scripts"),
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
  },
});
