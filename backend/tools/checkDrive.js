const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function check() {
  const { STORAGE_PROVIDER, validateStorageConfig } = require('./storageConfig');
  validateStorageConfig();
  if (STORAGE_PROVIDER !== 'google_drive') throw new Error('STORAGE_PROVIDER is not google_drive');
  const result = await require('./googleDriveStorage').getDriveStorage().checkFolder();
  console.log(JSON.stringify(result));
}

check().catch((error) => {
  // Only errors sanitized by the Drive adapter or config validation reach here.
  console.error(error.message);
  process.exitCode = 1;
});
