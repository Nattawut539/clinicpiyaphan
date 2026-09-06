const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadRoot = path.resolve(
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"),
);
const profileUploadDir = path.join(uploadRoot, "profiles");

fs.mkdirSync(profileUploadDir, { recursive: true });

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
  storage,
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

function getPublicProfileImagePath(file) {
  return file ? `/uploads/profiles/${file.filename}` : null;
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
      removeManagedProfileImage(getPublicProfileImagePath(req.file)).catch((error) => {
        console.error("Profile image cleanup failed:", error);
      });
    }
  });
  next();
}

function acceptProfileImage(req) {
  if (req.file) req.profileImageCommitted = true;
}

async function discardUploadedProfileImage(req) {
  if (!req.file) return false;
  req.profileImageCommitted = false;
  return removeManagedProfileImage(getPublicProfileImagePath(req.file));
}

function commitProfileImage(req, previousImage) {
  if (!req.file) return;
  req.profileImageCommitted = true;

  if (previousImage && previousImage !== getPublicProfileImagePath(req.file)) {
    removeManagedProfileImage(previousImage).catch((error) => {
      console.error("Old profile image cleanup failed:", error);
    });
  }
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
};
