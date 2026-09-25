// electron-builder afterPack hook: ad-hoc signs the macOS app, since there is no Apple Developer ID
// yet. Apple Silicon only runs signed code, and electron-builder changes the bundle after Electron
// signed it. Ad-hoc is enough for installs by script (curl sets no quarantine flag); a browser
// download would still be blocked by Gatekeeper until the app is signed and notarized.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(app)}`);
};
