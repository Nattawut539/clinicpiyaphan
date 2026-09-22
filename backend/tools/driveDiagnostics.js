// Only fixed, allowlisted messages may reach deployment logs. Google SDK errors
// can contain credentials in their messages, request bodies and headers.
function driveCheckError(error) {
  const status = Number(error?.response?.status || error?.code);
  const oauthError = error?.response?.data?.error;
  const reason = oauthError?.errors?.[0]?.reason;
  let diagnosis = 'DRIVE_UNAVAILABLE';
  let hint = 'Google Drive check failed. Verify Drive configuration, permissions and connectivity.';
  if (oauthError === 'invalid_grant') {
    diagnosis = 'DRIVE_INVALID_GRANT';
    hint = 'Google rejected the refresh token (expired, revoked or invalid). Reauthorize the storage account using the same OAuth client and replace GOOGLE_DRIVE_REFRESH_TOKEN. Check whether the OAuth app is in Testing.';
  } else if (oauthError === 'invalid_client' || oauthError === 'unauthorized_client') {
    diagnosis = 'DRIVE_INVALID_CLIENT';
    hint = 'Verify GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET belong to the OAuth client that issued the refresh token.';
  } else if (status === 401) {
    diagnosis = 'DRIVE_UNAUTHORIZED';
    hint = 'Google rejected storage authentication. Verify the Drive OAuth client and refresh token.';
  } else if (reason === 'accessNotConfigured' || oauthError?.details?.some?.((detail) => detail.reason === 'SERVICE_DISABLED')) {
    diagnosis = 'DRIVE_API_DISABLED';
    hint = 'Enable Google Drive API in the Google Cloud project used by the storage OAuth client.';
  } else if (status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) {
    diagnosis = 'DRIVE_RATE_LIMITED';
    hint = 'Google Drive rate limit reached. Wait and retry deployment.';
  } else if (status === 403) {
    diagnosis = 'DRIVE_FORBIDDEN';
    hint = 'Verify the storage account can edit the folder and the token has the required Drive scope; also check Google Cloud API and organization restrictions.';
  } else if (status === 404) {
    diagnosis = 'DRIVE_FOLDER_NOT_FOUND';
    hint = 'Check GOOGLE_DRIVE_FOLDER_ID and folder access for the account that authorized the refresh token. Google can return 404 for inaccessible folders.';
  } else if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.code) || status >= 500) {
    diagnosis = 'DRIVE_CONNECTION_FAILED';
    hint = 'Google Drive could not be reached or returned a server error. Check connectivity and retry.';
  }
  return Object.assign(new Error(`[${diagnosis}] ${hint}`), { status: 503, code: diagnosis });
}

module.exports = { driveCheckError };
