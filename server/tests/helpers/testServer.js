import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..", "..");

// Spawns the real server as a child process against a dedicated test database, the same way
// this app was manually verified throughout development (boot the real process, hit it over
// HTTP) rather than importing index.js in-process - index.js has no exported app/server handle
// separate from its own top-level connect-and-listen bootstrap, so this is the practical way to
// drive it from a test without changing that bootstrap's risk profile.
export function startTestServer({ port, mongoUri, extraEnv = {} }) {
  const child = spawn(process.execPath, ["index.js"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: mongoUri,
      NODE_ENV: "test",
      DEMO_MODE: "false",
      JWT_SECRET: "test-only-jwt-secret-at-least-32-characters",
      FEATURE_QUEUE_PROCESSING: process.env.REDIS_URL ? "true" : "false",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuffer = "";
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  async function waitUntilReady(timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (child.exitCode !== null) {
        throw new Error(`Server process exited early (code ${child.exitCode}). Stderr:\n${stderrBuffer.slice(-4000)}`);
      }
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) return;
      } catch {
        // Not accepting connections yet - keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Server did not become ready within ${timeoutMs}ms. Stderr:\n${stderrBuffer.slice(-4000)}`);
  }

  async function stop() {
    if (child.exitCode !== null) return;
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }

  return { baseUrl, waitUntilReady, stop };
}
