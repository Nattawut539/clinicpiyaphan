# Render backend: Google Drive preflight

`npm run start:render` runs storage preflight before starting `server.js`.
`Google Drive storage is unavailable` alone does not identify the cause. Updated
code prints a fixed diagnostic code and a remediation hint, without SDK errors,
tokens, request headers, account details or folder IDs.

Deploy this revision to obtain the code in Render's deploy logs. If a shell is
available, run `node tools/checkDrive.js` from the backend directory to check
only storage (no database queries or file writes).

| Diagnostic | Action in Render / Google Cloud |
| --- | --- |
| `DRIVE_INVALID_GRANT` | Reauthorize the storage Google account using the correct OAuth client and replace `GOOGLE_DRIVE_REFRESH_TOKEN`. A token may have expired or been revoked. Check the OAuth app's publishing status. External apps in Testing requesting Drive scopes receive refresh tokens valid for 7 days. |
| `DRIVE_INVALID_CLIENT` / `DRIVE_UNAUTHORIZED` | Check `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` and their relationship to the refresh token. These are storage credentials, separate from the website's Google login configuration. |
| `DRIVE_FOLDER_NOT_FOUND` | Check `GOOGLE_DRIVE_FOLDER_ID` is the folder ID and the account that authorized the token can access it. Inaccessible folders can also return 404. |
| `DRIVE_FOLDER_READ_ONLY` | Give that account permission to add files to the folder. The folder need not be public. |
| `DRIVE_INVALID_FOLDER` | Use a folder, not an image/file ID; restore it if trashed. |
| `DRIVE_API_DISABLED` | Enable Google Drive API in the storage OAuth client's Google Cloud project. |
| `DRIVE_FORBIDDEN` | Check OAuth scopes, folder permissions and organization/API restrictions. |
| `DRIVE_RATE_LIMITED` / `DRIVE_CONNECTION_FAILED` | Check service availability/connectivity and retry after the transient condition clears. |
| `DRIVE_UNAVAILABLE` | The response did not match a known safe diagnosis; investigate through Google Cloud and Render without printing raw OAuth errors. |

Update credentials directly in Render Environment, save and redeploy. Do not
paste secrets into chat or commit them. A successful local check only verifies
the local environment, not Render's configuration. Keep the storage check in
place: bypassing it does not repair profile image uploads.

After storage passes, preflight continues with the database checks. For the
medical consent release, apply `database/medical_consent_migration.sql` before
deploying the API.

Sources:
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/workspace/drive/api/guides/handle-errors
- https://render.com/docs/troubleshooting-deploys
