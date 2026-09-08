const pool = require("./db");

async function ensureProfileImageSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE clinic.user_details ADD COLUMN IF NOT EXISTS profile_image_drive_id TEXT");
    await client.query("CREATE INDEX IF NOT EXISTS user_details_profile_image_drive_idx ON clinic.user_details(profile_image_drive_id) WHERE profile_image_drive_id IS NOT NULL");
    await client.query(`CREATE TABLE IF NOT EXISTS clinic.profile_image_cleanup (
      drive_file_id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      attempts INTEGER NOT NULL DEFAULT 0
    )`);
    await client.query("REVOKE ALL ON clinic.profile_image_cleanup FROM PUBLIC");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
module.exports = ensureProfileImageSchema;
