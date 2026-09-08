const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("./db");
const { getDriveStorage } = require("./googleDriveStorage");

async function main() {
  const images = await pool.query(`SELECT detail_id, profile_image_drive_id
    FROM clinic.user_details WHERE profile_image_drive_id IS NOT NULL ORDER BY detail_id`);
  let readable = 0;
  for (const row of images.rows) {
    const image = await getDriveStorage().read(row.profile_image_drive_id);
    for await (const _chunk of image.stream) { /* consume and verify the response */ }
    readable += 1;
  }
  const legacy = await pool.query(`SELECT count(*)::int AS count FROM clinic.user_details
    WHERE profile_image LIKE '/uploads/profiles/%' AND profile_image_drive_id IS NULL`);
  const pending = await pool.query("SELECT count(*)::int AS count FROM clinic.profile_image_cleanup");
  console.log(JSON.stringify({
    ok: images.rowCount === readable && legacy.rows[0].count === 0 && pending.rows[0].count === 0,
    drive_rows: images.rowCount,
    drive_files_readable: readable,
    legacy_rows_remaining: legacy.rows[0].count,
    pending_cleanup: pending.rows[0].count,
  }, null, 2));
  if (images.rowCount !== readable || legacy.rows[0].count || pending.rows[0].count) process.exitCode = 1;
}

main().catch(() => {
  console.error("Profile image migration verification failed");
  process.exitCode = 1;
}).finally(() => pool.end());
