const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const pool = require("./db");
const { uploadRoot } = require("./profileImageUpload");

const profileDir = path.join(uploadRoot, "profiles");
const dataUrlPattern = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;
const extensionByMime = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function hasValidSignature(mimetype, buffer) {
  if (mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimetype === "image/gif") {
    return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  }
  return buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

async function migrateRow(row) {
  const match = String(row.profile_image || "").match(dataUrlPattern);
  if (!match) return { status: "skipped", detailId: row.detail_id };

  const mimetype = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > 3 * 1024 * 1024 || !hasValidSignature(mimetype, buffer)) {
    return { status: "invalid", detailId: row.detail_id };
  }

  const filename = `${crypto.randomUUID()}${extensionByMime[mimetype]}`;
  const filePath = path.join(profileDir, filename);
  const publicPath = `/uploads/profiles/${filename}`;

  await fs.promises.writeFile(filePath, buffer, { flag: "wx" });
  try {
    const result = await pool.query(
      `UPDATE clinic.user_details
       SET profile_image = $1, updated_at = now()
       WHERE detail_id = $2 AND profile_image = $3`,
      [publicPath, row.detail_id, row.profile_image],
    );
    if (!result.rowCount) {
      await fs.promises.unlink(filePath).catch(() => {});
      return { status: "changed", detailId: row.detail_id };
    }
    return { status: "migrated", detailId: row.detail_id, publicPath };
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }
}

async function main() {
  await fs.promises.mkdir(profileDir, { recursive: true });
  const { rows } = await pool.query(
    `SELECT detail_id, profile_image
     FROM clinic.user_details
     WHERE profile_image LIKE 'data:image/%;base64,%'
     ORDER BY detail_id`,
  );

  const summary = { found: rows.length, migrated: 0, invalid: 0, skipped: 0, changed: 0 };
  for (const row of rows) {
    const result = await migrateRow(row);
    summary[result.status] += 1;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
