const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("./db");
const { cleanupPendingImages } = require("./profileImageCleanup");
const { validateStorageConfig } = require("./storageConfig");
validateStorageConfig();
cleanupPendingImages().then((result) => {
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
}).catch(() => { console.error("Profile image cleanup failed; entries retained for retry"); process.exitCode = 1; })
  .finally(() => pool.end());
