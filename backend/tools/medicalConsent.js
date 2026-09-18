const CONSENT_VERSION = '2026-09-18';

function assertConsentAccess(user, req) {
  if (!['user', 'users'].includes(user.role) || user.medical_consent) return;
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/$/, '');
  const allowed = (req.method === 'GET' && ['/api/users/me', '/api/users/medical-consent'].includes(path))
    || (req.method === 'POST' && ['/api/users/medical-consent', '/api/users/logout'].includes(path));
  if (allowed) return;
  const error = new Error('กรุณายินยอมการใช้ข้อมูลส่วนบุคคลและข้อมูลสุขภาพก่อนเข้าใช้งาน');
  error.status = 403;
  error.code = 'MEDICAL_CONSENT_REQUIRED';
  throw error;
}

module.exports = { CONSENT_VERSION, assertConsentAccess };
