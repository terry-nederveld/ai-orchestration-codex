import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const bundle =
  process.platform === "darwin" ? "app" : process.platform === "win32" ? "nsis" : "appimage";
execFileSync(resolve("node_modules/.bin/tauri"), ["build", "--bundles", bundle], {
  stdio: "inherit",
});
