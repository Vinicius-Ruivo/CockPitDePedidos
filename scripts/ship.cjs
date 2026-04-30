/**
 * Deploy PCF (npm run deploy) + git add / commit / push.
 * Uso:
 *   npm run ship
 *   npm run ship -- "fix: alinha resumo com os cards"
 * Sem mensagem, gera commit automático com data/hora (UTC).
 */
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
process.chdir(root);

/** npm no Windows: usar npm.cmd para spawn sem shell. */
function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(cmd, args, useShell = false, extraEnv = null) {
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    env,
    shell: useShell,
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0 && r.status !== null) {
    process.exit(r.status);
  }
}

const commitMessage = process.argv.slice(2).join(" ").trim();

console.log("\n[ship] 1/3  npm run deploy\n");
run(npmBin(), ["run", "deploy"], false);

console.log("\n[ship] 2/3  git add / commit\n");
run("git", ["add", "-A"], false);

const st = spawnSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
  cwd: root,
});
if (!st.stdout.trim()) {
  console.log(
    "[ship] Nada novo para commitar (working tree vazio após add — ex.: só gerou artefactos em pastas ignoradas).",
  );
} else {
  const msg =
    commitMessage ||
    `chore: deploy ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  run("git", ["commit", "-m", msg], false);
}

console.log("\n[ship] 3/3  git push (pre-push em silêncio — deploy já feito no passo 1)\n");
run("git", ["push"], false, { SKIP_PRE_PUSH_DEPLOY: "1" });
console.log("\n[ship] Concluído.\n");
