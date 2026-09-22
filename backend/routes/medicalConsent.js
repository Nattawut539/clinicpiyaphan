const router = require('express').Router();
const { authRequired, withContext } = require('../tools/_utils');
const { CONSENT_VERSION } = require('../tools/medicalConsent');
const { clearCookieOptions } = require('../tools/cookies');

router.get('/medical-consent', authRequired, (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ accepted: req.user.medical_consent, version: CONSENT_VERSION });
});

router.post('/medical-consent', authRequired, async (req, res, next) => {
  if (!['user', 'users'].includes(req.user.role)) return res.sendStatus(403);
  const { accepted, version } = req.body || {};
  if (typeof accepted !== 'boolean' || version !== CONSENT_VERSION) {
    return res.status(400).json({ message: 'กรุณาเลือกความยินยอมจากประกาศฉบับปัจจุบัน' });
  }
  try {
    await withContext(req, async (client) => {
      if (accepted) {
        await client.query(`UPDATE clinic.users
          SET medical_consent_at = CASE WHEN medical_consent_version = $2 THEN COALESCE(medical_consent_at, now()) ELSE now() END,
              medical_consent_version = $2 WHERE user_id = $1`, [req.user.user_id, CONSENT_VERSION]);
      } else {
        await client.query(`UPDATE clinic.users SET medical_consent_at = NULL, medical_consent_version = NULL,
          session_version = session_version + 1 WHERE user_id = $1`, [req.user.user_id]);
      }
    });
    if (!accepted) {
      res.clearCookie('authToken', clearCookieOptions({ httpOnly: true }));
      res.clearCookie('userToken', clearCookieOptions({ httpOnly: false }));
    }
    res.json({ accepted });
  } catch (error) { next(error); }
});

module.exports = router;
