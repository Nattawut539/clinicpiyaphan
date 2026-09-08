const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { STORAGE_PROVIDER } = require("./storageConfig");
const { getDriveStorage } = require("./googleDriveStorage");
const { queueDriveCleanup, cleanupDriveImage } = require("./profileImageCleanup");
const pool = require("./db");

const uploadRoot = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"),
);
const profileUploadDir = path.join(uploadRoot, "profiles");

if (STORAGE_PROVIDER === "local") fs.mkdirSync(profileUploadDir, { recursive: true });

const extensionByMime = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, profileUploadDir),
  filename: (_req, file, callback) => {
    const extension = extensionByMime.get(String(file.mimetype || "").toLowerCase());
    if (!extension) {
      const error = new Error("รองรับเฉพาะไฟล์ JPG, PNG, WEBP และ GIF");
      error.status = 400;
      return callback(error);
    }
    return callback(null, `${crypto.randomUUID()}${extension}`);
  },
});

const uploadProfileImage = multer({
  storage: STORAGE_PROVIDER === "google_drive" ? multer.memoryStorage() : storage,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!extensionByMime.has(String(file.mimetype || "").toLowerCase())) {
      const error = new Error("รองรับเฉพาะไฟล์ JPG, PNG, WEBP และ GIF");
      error.status = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

function getPublicProfileImagePath(file, userId) {
  if (!file) return null;
  return STORAGE_PROVIDER === "google_drive"
    ? `/api/profile-images/${userId}`
    : `/uploads/profiles/${file.filename}`;
}

function hasValidImageSignature(mimetype, buffer) {
  if (!buffer?.length) return false;
  if (mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (mimetype === "image/gif") {
    const header = buffer.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimetype === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

async function validateProfileImageContent(req, _res, next) {
  if (!req.file) return next();

  try {
    if (req.file.buffer) {
      if (!hasValidImageSignature(req.file.mimetype, req.file.buffer)) {
        return next(Object.assign(new Error("เนื้อหาไฟล์ไม่ตรงกับชนิดรูปภาพ"), { status: 400 }));
      }
      return next();
    }
    const handle = await fs.promises.open(req.file.path, "r");
    try {
      const buffer = Buffer.alloc(12);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (!hasValidImageSignature(req.file.mimetype, buffer.subarray(0, bytesRead))) {
        const error = new Error("เนื้อหาไฟล์ไม่ตรงกับชนิดรูปภาพ");
        error.status = 400;
        return next(error);
      }
    } finally {
      await handle.close();
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function getManagedFilePath(publicPath) {
  const normalized = String(publicPath || "").replace(/\\/g, "/");
  if (!normalized.startsWith("/uploads/profiles/")) return null;

  const filename = path.basename(normalized);
  const resolved = path.resolve(profileUploadDir, filename);
  if (path.dirname(resolved) !== profileUploadDir) return null;
  return resolved;
}

async function removeManagedProfileImage(publicPath) {
  const filePath = getManagedFilePath(publicPath);
  if (!filePath) return false;

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function cleanupUncommittedUpload(req, res, next) {
  res.once("finish", () => {
    if (req.file && !req.profileImageCommitted) {
      discardUploadedProfileImage(req).catch(() => console.error("Profile image cleanup pending"));
    }
  });
  next();
}

function acceptProfileImage(req) {
  if (req.file) req.profileImageCommitted = true;
}

async function discardUploadedProfileImage(req) {
  if (!req.file) return false;
  if (req.profileImageCommitted) return false;
  req.profileImageCommitted = false;
  if (STORAGE_PROVIDER === "google_drive") {
    if (req.driveFileId) await cleanupDriveImage(req.driveFileId);
    return true;
  }
  return removeManagedProfileImage(getPublicProfileImagePath(req.file));
}

function commitProfileImage(req, previousImage) {
  if (!req.file) return;
  req.profileImageCommitted = true;
  if (previousImage?.profile_image_drive_id) {
    cleanupDriveImage(previousImage.profile_image_drive_id).catch(() => console.error("Old Drive image cleanup pending"));
  }
  previousImage = previousImage?.profile_image || previousImage;
  if (typeof previousImage !== "string") return;
  if (previousImage && previousImage !== getPublicProfileImagePath(req.file)) {
    removeManagedProfileImage(previousImage).catch((error) => {
      console.error("Old profile image cleanup failed:", error);
    });
  }
}

async function persistProfileImage(req, userId) {
  if (!req.file) return null;
  if (STORAGE_PROVIDER === "google_drive") {
    const drive = getDriveStorage();
    req.driveFileId = await drive.allocateId();
    // Record before upload, so failed uploads and process crashes can be cleaned up.
    await queueDriveCleanup(pool, req.driveFileId);
    await drive.upload({ id: req.driveFileId,
      name: `${crypto.randomUUID()}${extensionByMime.get(req.file.mimetype)}`,
      mimetype: req.file.mimetype, buffer: req.file.buffer });
  }
  return { profile_image: getPublicProfileImagePath(req.file, userId), profile_image_drive_id: req.driveFileId || null };
}

async function finalizeProfileImage(client, req, previousImage) {
  if (!req.file) return;
  if (previousImage?.profile_image_drive_id) await queueDriveCleanup(client, previousImage.profile_image_drive_id);
  if (req.driveFileId) await client.query("DELETE FROM clinic.profile_image_cleanup WHERE drive_file_id=$1", [req.driveFileId]);
}

module.exports = {
  uploadRoot,
  uploadProfileImage,
  cleanupUncommittedUpload,
  validateProfileImageContent,
  acceptProfileImage,
  discardUploadedProfileImage,
  getPublicProfileImagePath,
  removeManagedProfileImage,
  commitProfileImage,
  persistProfileImage,
  finalizeProfileImage,
  hasValidImageSignature,
  getManagedFilePath,
  extensionByMime,
};
