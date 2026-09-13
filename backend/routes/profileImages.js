const express = require("express");
const { pipeline } = require("stream/promises");
const pool = require("../tools/db");
const { authRequired } = require("../tools/_utils");
const { getDriveStorage } = require("../tools/googleDriveStorage");
const router = express.Router();
const staffRoles = new Set(["doctor", "assistant", "admin", "super_admin", "superadmin"]);

router.get("/clinic-assets/doctor-image", async (_req, res) => {
  const fileId = String(process.env.DOCTOR_IMAGE_DRIVE_ID || "").trim();
  if (!fileId) return res.status(404).json({ message: "Doctor image is not configured" });

  try {
    const image = await getDriveStorage().readPublicAsset(fileId);
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", image.mimetype);
    if (Number.isFinite(image.size)) res.setHeader("Content-Length", image.size);
    await pipeline(image.stream, res);
  } catch (error) {
    console.error("GET /clinic-assets/doctor-image failed", {
      code: error.code || "DRIVE_UNAVAILABLE",
      status: error.status || 503,
    });
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    res.removeHeader("Content-Length");
    res.status(error.status === 404 ? 404 : 503).json({ message: "Unable to load doctor image" });
  }
});

router.get("/profile-images/:userId", authRequired, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ message: "Invalid user ID" });
  if (Number(req.user.user_id) !== userId && !staffRoles.has(req.user.role)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  try {
    const { rows } = await pool.query(`SELECT profile_image_drive_id FROM clinic.user_details
      WHERE user_id=$1 ORDER BY detail_id DESC LIMIT 1`, [userId]);
    if (!rows[0]?.profile_image_drive_id) return res.status(404).json({ message: "Image not found" });
    const image = await getDriveStorage().read(rows[0].profile_image_drive_id);
    res.setHeader("Content-Type", image.mimetype);
    if (Number.isFinite(image.size)) res.setHeader("Content-Length", image.size);
    await pipeline(image.stream, res);
  } catch (error) {
    if (res.headersSent || res.destroyed) { res.destroy(); return; }
    res.removeHeader("Content-Length");
    res.status(error.status === 404 ? 404 : 503).json({ message: "Unable to load profile image" });
  }
});
module.exports = router;
