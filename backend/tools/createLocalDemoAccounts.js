// Local-only bootstrap. Never loads .env or modifies existing accounts.
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Set NODE_ENV=development for local demo setup');
  }
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/cliniccare_demo' || url.search || url.hash) {
    throw new Error('DATABASE_URL must point to local cliniccare_demo without query parameters');
  }
  const password = process.env.DEMO_PASSWORD || '';
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('DEMO_PASSWORD must contain at least 12 characters and at most 72 UTF-8 bytes');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const pool = new Pool({ connectionString: url.href, ssl: false });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const [username, role, firstName] of [
      ['demo_admin', 'super_admin', 'ผู้ดูแลทดสอบ'],
      ['demo_patient', 'user', 'ผู้ใช้ทดสอบ'],
    ]) {
      const email = `${username}@example.test`;
      const result = await client.query(`
        INSERT INTO clinic.users
          (username, email, password_hash, role, account_status,
           email_verified_at, profile_completed_at, registration_source)
        VALUES ($1, $2, $3, $4, 'active', now(), now(), 'local')
        RETURNING user_id`, [username, email, passwordHash, role]);
      await client.query(`
        INSERT INTO clinic.user_details (user_id, first_name, last_name, email)
        VALUES ($1, $2, 'ข้อมูลจำลอง', $3)`, [result.rows[0].user_id, firstName, email]);
    }
    await client.query('COMMIT');
    console.log('Created demo_admin (super_admin) and demo_patient (user).');
    console.log('Use DEMO_PASSWORD to sign in. Patient consent is not pre-accepted.');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new Error('Demo accounts already exist; no existing accounts were changed');
    }
    throw new Error('Demo setup failed; verify the local database and migrations');
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof TypeError ? 'Set a valid local DATABASE_URL' : error.message);
  process.exitCode = 1;
});
