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
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(meta.mimeType) || Number(meta.size) > 3 * 1024 * 1024) {
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
  return { folderId, checkFolder, allocateId, upload, read, remove };
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
