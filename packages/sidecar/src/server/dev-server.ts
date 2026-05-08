import { ensureRenderDir, getRenderDir } from "./render-store.js";
import { startSidecarDevServer } from "./server.js";

async function main(): Promise<void> {
  // Make sure the render output directory exists before any Blender op tries
  // to write into it. Cheap; safe to call repeatedly.
  try {
    await ensureRenderDir();
    console.log(`[pipelinekit-sidecar] render dir ready at ${getRenderDir()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pipelinekit-sidecar] failed to prepare render dir: ${message}`);
  }

  await startSidecarDevServer();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pipelinekit-sidecar] failed to start: ${message}`);
  throw error;
});
