import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findAvailablePort(port = Number(process.env.PORT || 4000)) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(findAvailablePort(port + 1));
        return;
      }
      reject(error);
    });

    tester.listen(port, "127.0.0.1", () => {
      tester.close(() => resolve(port));
    });
  });
}

const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = path.resolve(frontendDirectory, "..");
const backendPort = await findAvailablePort();
process.env.PORT = String(backendPort);
process.env.BACKEND_PORT = String(backendPort);
process.env.VITE_API_URL = `http://127.0.0.1:${backendPort}`;

const backend = spawn(
  process.execPath,
  [path.join(repositoryDirectory, "backend", "src", "server.js")],
  {
    cwd: repositoryDirectory,
    stdio: "inherit",
    env: { ...process.env, PORT: String(backendPort), BACKEND_PORT: String(backendPort), VITE_API_URL: `http://127.0.0.1:${backendPort}` },
  }
);
const frontend = spawn(
  process.execPath,
  [
    path.join(frontendDirectory, "node_modules", "vite", "bin", "vite.js"),
    ...process.argv.slice(2),
  ],
  {
    cwd: frontendDirectory,
    stdio: "inherit",
    env: { ...process.env, PORT: String(backendPort), BACKEND_PORT: String(backendPort), VITE_API_URL: `http://127.0.0.1:${backendPort}` },
  }
);
const children = [backend, frontend];
let shuttingDown = false;

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Unable to start a development service:", error);
    shutdown(1);
  });
  child.on("close", (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
