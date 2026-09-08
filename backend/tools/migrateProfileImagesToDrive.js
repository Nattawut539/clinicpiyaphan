const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("./db");
const { STORAGE_PROVIDER, validateStorageConfig } = require("./storageConfig");
const { getDriveStorage } = require("./googleDriveStorage");
const { getManagedFilePath, hasValidImageSignature, extensionByMime,
  persistProfileImage, finalizeProfileImage, discardUploadedProfileImage } = require("./profileImageUpload");

async function readLegacyImage(value) {
  const match = String(value || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
  let buffer, mimetype;
  if (match) {
    if (match[2].length > 5 * 1024 * 1024) throw new Error("Image too large");
    mimetype = match[1];
    buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  } else {
    const filename = getManagedFilePath(value);
    if (!filename) throw new Error("Unsupported legacy image");
    const stat = await fs.stat(filename);
    if (stat.size > 3 * 1024 * 1024) throw new Error("Image too large");
    buffer = await fs.readFile(filename);
    mimetype = [...extensionByMime.keys()].find((type) => hasValidImageSignature(type, buffer));
  }
  if (!buffer.length || buffer.length > 3 * 1024 * 1024 || !hasValidImageSignature(mimetype, buffer)) {
    throw new Error("Invalid image");
  }
  return { buffer, mimetype };
}

async function migrateRow(row, backupDir) {
  const file = await readLegacyImage(row.profile_image);
  const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
  // Keep both the previous DB value and an independent copy of the original.
  await fs.writeFile(path.join(backupDir, `${row.detail_id}${extensionByMime.get(file.mimetype)}`), file.buffer, { flag: "wx" });
  await fs.appendFile(path.join(backupDir, "images.jsonl"), JSON.stringify({ ...row, sha256: hash }) + "\n");
  const req = { file };
  let committed = false;
  try {
    const image = await persistProfileImage(req, row.user_id);
    const downloaded = await getDriveStorage().read(image.profile_image_drive_id);
    const downloadedHash = crypto.createHash("sha256");
    for await (const chunk of downloaded.stream) downloadedHash.update(chunk);
    if (downloadedHash.digest("hex") !== hash) throw new Error("Uploaded image verification failed");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(`UPDATE clinic.user_details
        SET profile_image=$1, profile_image_drive_id=$2, updated_at=now()
        WHERE detail_id=$3 AND profile_image=$4 AND profile_image_drive_id IS NULL`,
      [image.profile_image, image.profile_image_drive_id, row.detail_id, row.profile_image]);
      if (updated.rowCount) await finalizeProfileImage(client, req, null);
      await client.query("COMMIT");
      committed = Boolean(updated.rowCount);
      req.profileImageCommitted = committed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
    if (!committed) await discardUploadedProfileImage(req);
    return committed ? "migrated" : "changed";
  } catch (error) {
    if (!committed) await discardUploadedProfileImage(req).catch(() => {});
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const summary = { mode: apply ? "apply" : "dry-run", found: 0, valid: 0, migrated: 0, changed: 0, failed: 0 };
  validateStorageConfig();
  if (STORAGE_PROVIDER !== "google_drive") throw new Error("Set STORAGE_PROVIDER=google_drive");
  let backupDir;
  if (apply) {
    await getDriveStorage().checkFolder();
    backupDir = path.resolve(__dirname, "../../.local-backups", `drive-images-${Date.now()}`);
    await fs.mkdir(backupDir, { recursive: true });
    summary.backup_directory = backupDir;
  }
  let afterId = 0;
  while (true) {
    const { rows } = await pool.query(`SELECT detail_id,user_id,profile_image FROM clinic.user_details
      WHERE detail_id > $1 AND profile_image_drive_id IS NULL
        AND (profile_image LIKE '/uploads/profiles/%' OR profile_image LIKE 'data:image/%')
      ORDER BY detail_id LIMIT 100`, [afterId]);
    if (!rows.length) break;
    for (const row of rows) {
      summary.found += 1;
      afterId = row.detail_id;
      try {
        if (apply) summary[await migrateRow(row, backupDir)] += 1;
        else { await readLegacyImage(row.profile_image); summary.valid += 1; }
      } catch {
        summary.failed += 1;
        console.error(`Image migration failed for detail_id=${row.detail_id}; original retained`);
      }
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) main().catch(() => {
  console.error("Image migration could not complete; check storage configuration and database migration");
  process.exitCode = 1;
}).finally(() => pool.end());
module.exports = { readLegacyImage, migrateRow };
