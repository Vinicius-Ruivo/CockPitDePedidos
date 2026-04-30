/**
 * Executa `pac pcf push` com o prefixo do publicador.
 * Ordem: env PAC_PATH → %USERPROFILE%\.dotnet\tools\pac(.exe) → "pac" no PATH.
 *
 *   PCF_PUBLISHER_PREFIX=cr660 npm run deploy
 */
const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");
const os = require("os");

const prefix = process.env.PCF_PUBLISHER_PREFIX || "cr660";

function resolvePac() {
  if (process.env.PAC_PATH && existsSync(process.env.PAC_PATH)) {
    return process.env.PAC_PATH;
  }
  const exe = os.platform() === "win32" ? "pac.exe" : "pac";
  const dotnetTools = path.join(os.homedir(), ".dotnet", "tools", exe);
  if (existsSync(dotnetTools)) return dotnetTools;
  return "pac";
}

const pac = resolvePac();
const args = ["pcf", "push", "--publisher-prefix", prefix];

const result = spawnSync(pac, args, {
  stdio: "inherit",
  env: process.env,
  shell: pac === "pac",
});

process.exit(result.status === null ? 1 : result.status);
