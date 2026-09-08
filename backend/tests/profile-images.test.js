const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createDriveStorage } = require("../tools/googleDriveStorage");

test("rejects a folder without write permission", async () => {
  const storage = createDriveStorage({ files: { get: async () => ({ data: {
    mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: false },
  } }) } }, "folder");
  await assert.rejects(storage.checkFolder(), { status: 503 });
});

test("cannot read or delete an image outside the configured folder", async () => {
  let deletes = 0, reads = 0;
  const storage = createDriveStorage({ files: {
    get: async (request) => {
      if (request.alt) reads++;
      return { data: { parents: ["other-folder"], mimeType: "image/png", appProperties: { clinic_profile_image: "1" } } };
    },
    delete: async () => { deletes++; },
  } }, "folder");
  await assert.rejects(storage.read("file"), { status: 404 });
  await assert.rejects(storage.remove("file"), { status: 404 });
  assert.equal(deletes, 0);
  assert.equal(reads, 0);
});

test("does not delete unrelated files even inside the configured folder", async () => {
  const storage = createDriveStorage({ files: { get: async () => ({ data: { parents: ["folder"] } }) } }, "folder");
  await assert.rejects(storage.remove("file"), { status: 404 });
});

test("does not expose tokens from Google API errors", async () => {
  const storage = createDriveStorage({ files: { generateIds: async () => {
    throw Object.assign(new Error("refresh_token=secret"), { response: { status: 401, config: { Authorization: "Bearer secret" } } });
  } } }, "folder");
  try { await storage.allocateId(); assert.fail("Expected failure"); }
  catch (error) {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.stack + JSON.stringify(error), /secret|Bearer/);
  }
});

test("streams managed image bytes and refuses oversized or non-image content", async () => {
  let meta = { parents: ["folder"], appProperties: { clinic_profile_image: "1" }, mimeType: "image/png", size: "3" };
  const storage = createDriveStorage({ files: { get: async (request) => ({ data: request.alt ? Readable.from([Buffer.from("png")]) : meta }) } }, "folder");
  const image = await storage.read("file");
  const chunks = [];
  for await (const chunk of image.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "png");
  meta = { ...meta, mimeType: "text/html" };
  await assert.rejects(storage.read("file"), { status: 404 });
  meta = { ...meta, mimeType: "image/png", size: String(4 * 1024 * 1024) };
  await assert.rejects(storage.read("file"), { status: 404 });
});
