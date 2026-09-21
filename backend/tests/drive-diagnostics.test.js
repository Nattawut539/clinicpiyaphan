const test = require('node:test');
const assert = require('node:assert/strict');
const { createDriveStorage } = require('../tools/googleDriveStorage');

test('folder preflight distinguishes Google failures without logging SDK secrets', async () => {
  const scenarios = [
    [{ response: { status: 400, data: { error: 'invalid_grant' } } }, 'DRIVE_INVALID_GRANT'],
    [{ response: { status: 401, data: { error: 'invalid_client' } } }, 'DRIVE_INVALID_CLIENT'],
    [{ response: { status: 401 } }, 'DRIVE_UNAUTHORIZED'],
    [{ response: { status: 403, data: { error: { errors: [{ reason: 'accessNotConfigured' }] } } } }, 'DRIVE_API_DISABLED'],
    [{ response: { status: 403 } }, 'DRIVE_FORBIDDEN'],
    [{ response: { status: 404 } }, 'DRIVE_FOLDER_NOT_FOUND'],
    [{ response: { status: 429 } }, 'DRIVE_RATE_LIMITED'],
    [{ code: 'ETIMEDOUT' }, 'DRIVE_CONNECTION_FAILED'],
    [{ response: { status: 503 } }, 'DRIVE_CONNECTION_FAILED'],
    [{ response: { status: 400, data: { error: 'sensitive-value' } } }, 'DRIVE_UNAVAILABLE'],
  ];
  for (const [details, code] of scenarios) {
    const raw = Object.assign(new Error('sensitive-value'), details, { config: { headers: { Authorization: 'Bearer sensitive-value' } } });
    const storage = createDriveStorage({ files: { get: async () => { throw raw; } } }, 'folder');
    await assert.rejects(storage.checkFolder(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.stack + JSON.stringify(error), /sensitive-value|Bearer/);
      return true;
    });
  }
});

test('folder preflight validates folder type, trash and write capability', async () => {
  for (const [data, code] of [
    [{ mimeType: 'image/png' }, 'DRIVE_INVALID_FOLDER'],
    [{ mimeType: 'application/vnd.google-apps.folder', trashed: true }, 'DRIVE_INVALID_FOLDER'],
    [{ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: false } }, 'DRIVE_FOLDER_READ_ONLY'],
  ]) {
    const storage = createDriveStorage({ files: { get: async () => ({ data }) } }, 'folder');
    await assert.rejects(storage.checkFolder(), { code });
  }
  const storage = createDriveStorage({ files: { get: async () => ({ data: {
    mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true },
  } }) } }, 'folder');
  assert.deepEqual(await storage.checkFolder(), { google_drive_folder_accessible: true, google_drive_folder_writable: true });
});
