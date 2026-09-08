// Integration test: creates only synthetic accounts and managed test images.
const path = require("path");
const fs = require("fs/promises");
const assert = require("assert/strict");
const crypto = require("crypto");
const express = require("express");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("../tools/db");
const { signToken } = require("../tools/_utils");
const { getDriveStorage } = require("../tools/googleDriveStorage");
const { queueDriveCleanup, cleanupDriveImage } = require("../tools/profileImageCleanup");

async function main() {
  if (process.env.PROFILE_IMAGE_TEST_ALLOW_MUTATION !== "true") throw new Error("Set PROFILE_IMAGE_TEST_ALLOW_MUTATION=true on a test environment");
  if (process.env.STORAGE_PROVIDER !== "google_drive") throw new Error("This workflow requires google_drive");
  const ids = [], imageIds = new Set();
  const suffix = crypto.randomBytes(6).toString("hex");
  let userSequence = 0;
  const app = express();
  app.use(express.json());
  app.use(require("cookie-parser")());
  app.use("/api", require("../routes/users"));
  app.use("/api", require("../routes/profileImages"));
  app.use((error, _req, res, _next) => res.status(error.name === "MulterError" ? 400 : error.status || 500).json({ message: "Request rejected" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6H1sAAAAASUVORK5CYII=", "base64");
  async function createUser(role) {
    userSequence += 1;
    const email = `img_${role}_${userSequence}_${suffix}@test.local`;
    const { rows } = await pool.query(`INSERT INTO clinic.users(username,email,password_hash,role,account_status,session_version)
      VALUES($1,$2,'not-a-login-password',$3,'active',1) RETURNING user_id,role,email,session_version`, [`img_${role}_${userSequence}_${suffix}`, email, role]);
    const user = rows[0];
    ids.push(user.user_id);
    await pool.query("INSERT INTO clinic.user_details(user_id,first_name,last_name,email) VALUES($1,'Storage','Test',$2)", [user.user_id, email]);
    return { ...user, token: signToken(user) };
  }
  async function upload(user, route = "/api/me/profile", extra = {}, bytes = png, method = "PATCH") {
    const body = new FormData();
    for (const [key, value] of Object.entries({ first_name: "Storage", last_name: "Test", email: user.email, ...extra })) body.set(key, value);
    body.set("file", new Blob([bytes], { type: "image/png" }), "test.png");
    const response = await fetch(base + route, { method, headers: { Cookie: `authToken=${user.token}` }, body });
    return { status: response.status, body: await response.json() };
  }
  async function stored(id) {
    const { rows } = await pool.query("SELECT profile_image,profile_image_drive_id FROM clinic.user_details WHERE user_id=$1", [id]);
    if (rows[0]?.profile_image_drive_id) imageIds.add(rows[0].profile_image_drive_id);
    return rows[0];
  }
  try {
    const owner = await createUser("user"), staff = await createUser("admin");
    const first = await upload(owner);
    assert.equal(first.status, 200, JSON.stringify(first));
    const initial = await stored(owner.user_id);
    assert.equal(initial.profile_image, `/api/profile-images/${owner.user_id}`);
    const view = await fetch(base + initial.profile_image, { headers: { Cookie: `authToken=${owner.token}` } });
    assert.equal(view.status, 200);
    assert.equal(view.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await view.arrayBuffer()), png);
    assert.equal((await fetch(base + initial.profile_image)).status, 401);
    assert.equal((await fetch(base + `/api/profile-images/${staff.user_id}`, { headers: { Cookie: `authToken=${owner.token}` } })).status, 403);
    assert.equal((await fetch(base + initial.profile_image, { headers: { Cookie: `adminToken=${staff.token}` } })).status, 200);

    assert.equal((await upload(owner, undefined, {}, Buffer.from("not-an-image"))).status, 400);
    assert.equal((await upload(owner, undefined, {}, Buffer.alloc(3 * 1024 * 1024 + 1))).status, 400);
    const rollback = await upload(owner, undefined, { province_code: "INVALID", email: `changed_${suffix}@test.local` });
    assert.equal(rollback.status, 400);
    assert.deepEqual(await stored(owner.user_id), initial);
    const email = await pool.query("SELECT email FROM clinic.users WHERE user_id=$1", [owner.user_id]);
    assert.equal(email.rows[0].email, owner.email);
    const replaced = await upload(staff, `/api/patients/${owner.user_id}/profile`, {}, png, "PUT");
    assert.equal(replaced.status, 200, JSON.stringify(replaced));
    const latest = await stored(owner.user_id);
    assert.notEqual(latest.profile_image_drive_id, initial.profile_image_drive_id);
    await cleanupDriveImage(initial.profile_image_drive_id);
    await assert.rejects(getDriveStorage().read(initial.profile_image_drive_id), { status: 404 });
    const me = await fetch(base + "/api/me/profile", { headers: { Cookie: `authToken=${owner.token}` } });
    const meBody = await me.json();
    assert.equal(meBody.profile_image, latest.profile_image);
    assert.equal(Object.hasOwn(meBody, "profile_image_drive_id"), false);

    const deletedPatient = await createUser("user");
    assert.equal((await upload(deletedPatient)).status, 200);
    const deletedImage = await stored(deletedPatient.user_id);
    const deleted = await fetch(base + `/api/patients/${deletedPatient.user_id}`, {
      method: "DELETE", headers: { Cookie: `adminToken=${staff.token}` },
    });
    assert.equal(deleted.status, 200, await deleted.text());
    await cleanupDriveImage(deletedImage.profile_image_drive_id);
    await assert.rejects(getDriveStorage().read(deletedImage.profile_image_drive_id), { status: 404 });
    console.log(JSON.stringify({ ok: true, upload: true, cookie_read: true, exact_bytes: true,
      ownership: true, staff_read: true, invalid_files: true, rollback: true, staff_replace: true,
      old_image_removed: true, deleted_patient_image_removed: true }));
  } finally {
    for (const id of ids) await stored(id);
    await pool.query("DELETE FROM clinic.users WHERE user_id=ANY($1::int[])", [ids]);
    let failed = 0;
    for (const id of imageIds) {
      await queueDriveCleanup(pool, id);
      try { await cleanupDriveImage(id); } catch { failed++; }
    }
    await new Promise((resolve) => server.close(resolve));
    console.log(JSON.stringify({ synthetic_accounts_removed: true, image_cleanup_failures: failed }));
    if (failed) process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
