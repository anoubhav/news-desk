import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HighlightManifest } from "../../../shared/models";

const HF_BIN = process.env.HYPERFRAMES_RENDER_BIN || "npx";
const HF_BIN_ARGS = HF_BIN === "npx" ? ["--yes", "hyperframes@0.6.6"] : [];

interface RenderArgs {
  manifest: HighlightManifest;
  /** Path to the hyperframes/ project directory. */
  projectDir: string;
  /** Composition html (relative to project root) to render. */
  composition: string;
  /** Absolute path where the resulting MP4 should be written. */
  outPath: string;
}

interface RenderResult {
  manifestPath: string;
  mp4Path: string;
  durationSec: number;
  renderMs: number;
  stderrTail: string;
}

/**
 * Spawns `npx hyperframes render` and waits for completion. The manifest is
 * serialized to JSON inside the project directory so the composition can fetch
 * it at runtime via window.__hfVariables (Hyperframes' top-level variable
 * channel — see the §1 note in the plan file about bundle-mode variables).
 *
 * Resolves with the rendered MP4 path + render duration. Rejects with a
 * descriptive error including the last 20 lines of stderr if the CLI exits
 * non-zero.
 */
export function renderHighlight({
  manifest,
  projectDir,
  composition,
  outPath,
}: RenderArgs): Promise<RenderResult> {
  return new Promise((resolve, reject) => {
    const manifestPath = join(projectDir, `manifests/${manifest.sessionId}.json`);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    mkdirSync(dirname(outPath), { recursive: true });

    const variables = JSON.stringify({
      manifestUrl: `manifests/${manifest.sessionId}.json`,
    });

    const args = [
      ...HF_BIN_ARGS,
      "render",
      composition,
      "--out",
      outPath,
      "--variables",
      variables,
    ];

    const startedAt = Date.now();
    const child = spawn(HF_BIN, args, {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });

    const stderrLines: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderrLines.push(text);
      if (stderrLines.length > 200) stderrLines.shift();
    });
    child.stdout.on("data", () => {
      // discard; render is noisy on stdout
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      const renderMs = Date.now() - startedAt;
      const stderrTail = stderrLines.slice(-20).join("");
      if (code !== 0) {
        reject(
          new Error(
            `hyperframes render exited ${code} after ${renderMs}ms.\nstderr tail:\n${stderrTail}`,
          ),
        );
        return;
      }
      if (!existsSync(outPath)) {
        reject(new Error(`hyperframes render completed but output missing: ${outPath}`));
        return;
      }
      resolve({
        manifestPath,
        mp4Path: outPath,
        durationSec: 0, // ffprobe later if we need the exact duration
        renderMs,
        stderrTail,
      });
    });
  });
}
