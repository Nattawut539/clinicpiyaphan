const { Readable } = require("stream");

// Never log Google SDK errors: they can contain Authorization headers and tokens.
function storageError(error) {
  const status = Number(error?.response?.status || error?.code);
  const mapped = new Error("Google Drive storage is unavailable");
  mapped.status = status === 404 ? 404 : 503;
  mapped.code = status === 404 ? "IMAGE_NOT_FOUND" : "DRIVE_UNAVAILABLE";
  return mapped;
}

function createDriveStorage(drive, folderId) {
  const options = { timeout: 30000, retry: false };
  const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const maxImageBytes = 3 * 1024 * 1024;
  async function checkFolder() {
    try {
      const { data } = await drive.files.get({ fileId: folderId, fields: "id,mimeType,trashed,capabilities(canAddChildren)" }, options);
      if (data.trashed || data.mimeType !== "application/vnd.google-apps.folder" || !data.capabilities?.canAddChildren) {
        throw new Error("Folder is not writable");
      }
      return { google_drive_folder_accessible: true, google_drive_folder_writable: true };
    } catch (error) { throw storageError(error); }
  }
  async function allocateId() {
    try {
      const { data } = await drive.files.generateIds({ count: 1, space: "drive", type: "files" }, options);
      if (!data.ids?.[0]) throw new Error("Missing file ID");
      return data.ids[0];
    } catch (error) { throw storageError(error); }
  }
  async function upload({ id, name, mimetype, buffer }) {
    try {
      await drive.files.create({
        requestBody: { id, name, parents: [folderId], appProperties: { clinic_profile_image: "1" } },
        media: { mimeType: mimetype, body: Readable.from([buffer]) },
        fields: "id",
      }, options);
      return id;
    } catch (error) { throw storageError(error); }
  }
  async function metadata(id) {
    try {
      const { data } = await drive.files.get({ fileId: id, fields: "id,mimeType,size,parents,trashed,appProperties" }, options);
      if (data.trashed || !data.parents?.includes(folderId) || data.appProperties?.clinic_profile_image !== "1") {
        throw Object.assign(new Error("Unmanaged image"), { code: 404 });
      }
      return data;
    } catch (error) { throw storageError(error); }
  }
  async function read(id) {
    const meta = await metadata(id);
    return readImage(id, meta);
  }
  async function readPublicAsset(id) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) {
      throw Object.assign(new Error("Invalid public asset ID"), { status: 404 });
    }
    let meta;
    try {
      const { data } = await drive.files.get({
        fileId: id,
        fields: "id,mimeType,size,trashed",
      }, options);
      meta = data;
    } catch (_error) {
      // Clinic branding is intentionally public. This fallback keeps the
      // website working when the OAuth account differs from the file owner.
      return readSharedPublicImage(id);
    }
    // This is a single, explicitly configured public asset. Unlike uploaded
    // patient profile images, it does not need to live in the managed upload
    // folder; the OAuth account only needs read access to the pinned file ID.
    if (meta.trashed) {
      throw Object.assign(new Error("Asset is trashed"), { status: 404 });
    }
    return readImage(id, meta);
  }
  async function readSharedPublicImage(id) {
    let response;
    try {
      response = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`, {
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
    } catch (_error) {
      throw Object.assign(new Error("Public Drive asset is unavailable"), { status: 503, code: "DRIVE_UNAVAILABLE" });
    }
    const mimetype = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !response.body || !allowedImageTypes.has(mimetype) || !Number.isFinite(size) || size > maxImageBytes) {
      response.body?.cancel().catch(() => {});
      throw Object.assign(new Error("Invalid public Drive image"), { status: response.status === 404 ? 404 : 503 });
    }
    return { stream: Readable.fromWeb(response.body), mimetype, size };
  }
  async function readImage(id, meta) {
    if (!allowedImageTypes.has(meta.mimeType) || Number(meta.size) > maxImageBytes) {
      throw Object.assign(new Error("Invalid stored image"), { status: 404 });
    }
    try {
      const { data } = await drive.files.get({ fileId: id, alt: "media" }, { ...options, responseType: "stream" });
      return { stream: data, mimetype: meta.mimeType, size: Number(meta.size) };
    } catch (error) { throw storageError(error); }
  }
  async function remove(id) {
    await metadata(id);
    try { await drive.files.delete({ fileId: id }, options); }
    catch (error) { throw storageError(error); }
  }
  return { folderId, checkFolder, allocateId, upload, read, readPublicAsset, remove };
}

let storage;
function getDriveStorage() {
  if (!storage) {
    const { google } = require("googleapis");
    const auth = new google.auth.OAuth2(process.env.GOOGLE_DRIVE_CLIENT_ID, process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
    storage = createDriveStorage(google.drive({ version: "v3", auth }), process.env.GOOGLE_DRIVE_FOLDER_ID);
  }
  return storage;
}
module.exports = { getDriveStorage, createDriveStorage };
