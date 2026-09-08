const pool = require("./db");
const { getDriveStorage } = require("./googleDriveStorage");

async function queueDriveCleanup(client, id, folderId = process.env.GOOGLE_DRIVE_FOLDER_ID) {
  if (!id) return;
  await client.query(`INSERT INTO clinic.profile_image_cleanup(drive_file_id, folder_id)
    VALUES($1,$2) ON CONFLICT (drive_file_id) DO NOTHING`, [id, folderId]);
}

async function cleanupDriveImage(id) {
  // Serializes cleanup workers; a referenced image is never deleted after an
  // ambiguous transaction/connection error. New pending uploads get a grace period.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pending = await client.query(`SELECT drive_file_id FROM clinic.profile_image_cleanup
      WHERE drive_file_id=$1 AND folder_id=$2 FOR UPDATE`, [id, process.env.GOOGLE_DRIVE_FOLDER_ID]);
    if (!pending.rowCount) { await client.query("COMMIT"); return; }
    const used = await client.query("SELECT 1 FROM clinic.user_details WHERE profile_image_drive_id=$1 LIMIT 1", [id]);
    if (!used.rowCount) {
      try { await getDriveStorage().remove(id); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    await client.query("DELETE FROM clinic.profile_image_cleanup WHERE drive_file_id=$1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("UPDATE clinic.profile_image_cleanup SET attempts=attempts+1 WHERE drive_file_id=$1", [id]).catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function cleanupPendingImages() {
  const { rows } = await pool.query(`SELECT drive_file_id FROM clinic.profile_image_cleanup
    WHERE folder_id=$1 AND created_at < now() - interval '1 hour' ORDER BY created_at LIMIT 100`,
  [process.env.GOOGLE_DRIVE_FOLDER_ID]);
  let failed = 0;
  for (const row of rows) {
    try { await cleanupDriveImage(row.drive_file_id); } catch { failed += 1; }
  }
  return { checked: rows.length, failed };
}
module.exports = { queueDriveCleanup, cleanupDriveImage, cleanupPendingImages };
