const path = require("path");
const fs = require("fs/promises");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { STORAGE_PROVIDER, uploadRoot, validateStorageConfig } = require("./storageConfig");
async function main() {
  validateStorageConfig();
  if (STORAGE_PROVIDER === "google_drive") {
    const result = await require("./googleDriveStorage").getDriveStorage().checkFolder();
    console.log(JSON.stringify({ ok: true, storage_provider: STORAGE_PROVIDER, ...result }));
  } else {
    await fs.access(uploadRoot, fs.constants.R_OK | fs.constants.W_OK);
    console.log(JSON.stringify({ ok: true, storage_provider: STORAGE_PROVIDER, upload_directory_writable: true }));
  }
}
main().catch(() => {
  console.error("Storage check failed. Check provider settings, OAuth credentials and folder access.");
  process.exitCode = 1;
});
