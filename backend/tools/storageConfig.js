const path = require("path");

const STORAGE_PROVIDER = String(process.env.STORAGE_PROVIDER || "local").trim();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"));
const DRIVE_ENV = ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "FOLDER_ID"];

function validateStorageConfig() {
  if (!["local", "google_drive"].includes(STORAGE_PROVIDER)) {
    throw new Error("STORAGE_PROVIDER must be local or google_drive");
  }
  if (STORAGE_PROVIDER === "google_drive") {
    const missing = DRIVE_ENV.filter((key) => !String(process.env[`GOOGLE_DRIVE_${key}`] || "").trim());
    if (missing.length) throw new Error(`Missing Google Drive configuration: ${missing.map((key) => `GOOGLE_DRIVE_${key}`).join(", ")}`);
    if (!/^[\w-]+$/.test(process.env.GOOGLE_DRIVE_FOLDER_ID)) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID must be a folder ID, not a URL");
    }
  }
}

module.exports = { STORAGE_PROVIDER, uploadRoot, validateStorageConfig };
