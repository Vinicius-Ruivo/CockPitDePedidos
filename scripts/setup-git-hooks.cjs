/**
 * Ativa ganchos Git versionados (pasta .githooks) neste repositório.
 * Corrida em `npm install` (script "prepare") e pode ser executada à mão.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const gitDir = path.join(root, ".git");
const prePush = path.join(root, ".githooks", "pre-push");

if (!fs.existsSync(gitDir)) {
  console.log("[setup-git-hooks] Sem .git — ignorado (CI / pacote sem repositório).");
  process.exit(0);
}

if (!fs.existsSync(prePush)) {
  console.warn("[setup-git-hooks] Aviso: .githooks/pre-push não encontrado.");
}

try {
  execSync("git config core.hooksPath .githooks", {
    cwd: root,
    stdio: "inherit",
  });
  console.log("[setup-git-hooks] core.hooksPath = .githooks (deploy antes de cada push).");
} catch {
  console.warn("[setup-git-hooks] Não foi possível configurar (git no PATH?).");
  process.exit(0);
}
