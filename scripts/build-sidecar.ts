import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { buildSync } from "esbuild";

const extension = process.platform === "win32" ? ".exe" : "";
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
if (!target) throw new Error("rustc did not report a host target triple");

const staging = resolve(`src-tauri/binaries/fable-control-plane-staging${extension}`);
const output = resolve(`src-tauri/binaries/fable-control-plane-${target}${extension}`);
const bundle = resolve("src-tauri/.sidecar/fable-control-plane.mjs");
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(bundle), { recursive: true });
rmSync(staging, { force: true });
rmSync(output, { force: true });
buildSync({
  entryPoints: [resolve("dist/cli/index.js")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
});
execFileSync(
  resolve("node_modules/.bin/pkg"),
  [
    bundle,
    "--target",
    "host",
    "--output",
    staging,
    "--compress",
    "GZip",
    "--no-bytecode",
    "--public",
    "--public-packages",
    "*",
  ],
  { stdio: "inherit" },
);
renameSync(staging, output);
process.stdout.write(`Built ${output}\n`);
