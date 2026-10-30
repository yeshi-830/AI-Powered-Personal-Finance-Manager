import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = path.resolve(frontendDirectory, "..");
const backend = spawn(
  process.execPath,
  [path.join(repositoryDirectory, "backend", "src", "server.js")],
  { cwd: repositoryDirectory, stdio: "inherit" }
);
const frontend = spawn(
  process.execPath,
  [
    path.join(frontendDirectory, "node_modules", "vite", "bin", "vite.js"),
    ...process.argv.slice(2),
  ],
  { cwd: frontendDirectory, stdio: "inherit" }
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
