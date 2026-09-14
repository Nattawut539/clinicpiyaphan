'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './login.module.css';
import ReCAPTCHA from 'react-google-recaptcha';
import { FcGoogle } from 'react-icons/fc';
import { FaLine, FaEye, FaEyeSlash } from 'react-icons/fa';
import Swal from 'sweetalert2';
import Link from 'next/link';
import Cookies from '@/lib/cookies';
import { useRouter } from 'next/navigation';
import { API_BASE } from '@/lib/api';
import ThaiDatePicker from '@/components/date/ThaiDatePicker';

const RECAPTCHA_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';

type ProvinceRow = {
    name_th: string;
};

type LoginRequestBody =
    | { email: string; password: string; remember_me: boolean }
    | { username: string; password: string; remember_me: boolean };

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export default function LoginPage() {
    const [hasMounted, setHasMounted] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // provinces
    const [province, setProvince] = useState<string>('');        // จังหวัดที่เลือก
    const [provincesList, setProvincesList] = useState<string[]>([]); // รายชื่อจังหวัดทั้งหมด

    // login
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);

    // recaptcha
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);
    const captchaRef = useRef<ReCAPTCHA>(null);

    // loading
    const [loadingLogin, setLoadingLogin] = useState(false);
    const [loadingReg, setLoadingReg] = useState(false);

    const router = useRouter();

    useEffect(() => { setHasMounted(true); }, []);
    useEffect(() => {
        const rememberedIdentifier = localStorage.getItem('rememberedLoginIdentifier');
        if (rememberedIdentifier) {
            setLoginUsername(rememberedIdentifier);
            setRememberMe(true);
        }
    }, []);
    useEffect(() => {
        const onResize = () => {
            setIsMobile(window.innerWidth <= 768);
        };
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    useEffect(() => {
        fetch(`${API_BASE}/provinces`)
            .then(r => r.json())
            .then((rows: ProvinceRow[]) => setProvincesList(rows.map(it => it.name_th)))
            .catch(() => setProvincesList([]));
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const oauthError = params.get('oauth_error');
        if (!oauthError) return;

        const providerParam = params.get('provider')?.toLowerCase();
        const provider = providerParam === 'line' ? 'LINE' : providerParam === 'google' ? 'Google' : 'บัญชีภายนอก';
        const accountStatus = params.get('account_status')?.toLowerCase();

        window.history.replaceState({}, '', window.location.pathname);

        if (oauthError === 'account_inactive') {
            const content = accountStatus === 'deactivated'
                ? {
                    title: 'บัญชีนี้ถูกหยุดใช้งานแล้ว',
                    text: `บัญชี ${provider} นี้ถูกปิดตามคำร้องของผู้ใช้ หากต้องการกลับมาใช้บัญชีเดิม กรุณาติดต่อคลินิกเพื่อขอคืนการใช้งาน`,
                }
                : accountStatus === 'suspended'
                    ? {
                        title: 'บัญชีถูกระงับการใช้งาน',
                        text: `ยังไม่สามารถเข้าสู่ระบบด้วย ${provider} ได้ กรุณาติดต่อคลินิกเพื่อตรวจสอบและขอเปิดใช้งานบัญชี`,
                    }
                    : {
                        title: 'บัญชีนี้ยังไม่พร้อมใช้งาน',
                        text: `ไม่สามารถเข้าสู่ระบบด้วย ${provider} ได้ กรุณาติดต่อคลินิกเพื่อตรวจสอบสถานะบัญชี`,
                    };

            void Swal.fire({
                icon: 'warning',
                title: content.title,
                html: `<p style="margin:0 0 14px;line-height:1.7;color:#526176">${content.text}</p><div style="padding:12px 14px;border-radius:12px;background:#f0fdfa;color:#0f766e;font-size:14px"><strong>ติดต่อคลินิก</strong><br>โทร 086-856-8646<br>อีเมล clinic.piyaphan@gmail.com</div>`,
                confirmButtonText: 'รับทราบ',
                confirmButtonColor: '#0f9f8f',
            });
            return;
        }

        void Swal.fire({
            icon: 'error',
            title: `เข้าสู่ระบบด้วย ${provider} ไม่สำเร็จ`,
            text: 'การยืนยันตัวตนอาจหมดอายุหรือถูกยกเลิก กรุณาลองเข้าสู่ระบบอีกครั้ง หากยังพบปัญหาให้ติดต่อคลินิก',
            confirmButtonText: 'รับทราบ',
            confirmButtonColor: '#2563eb',
        });
    }, []);

    if (!hasMounted) return null;

    // ===== OAuth =====
    const handleGoogleLogin = () => {
        window.location.href = `${API_BASE}/google/login`;
    };
    const handleLineLogin = () => {
        window.location.href = `${API_BASE}/line/login`;
    };

    // ===== Register =====
    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const fd = new FormData(form);

        const password = String(fd.get('password') || '');
        const confirmPassword = String(fd.get('confirm_password') || '');
        const email = String(fd.get('emergency_email') || ''); // ฟอร์มเดิมใช้ชื่อ emergency_email

        if (RECAPTCHA_KEY && !captchaToken) {
            Swal.fire({ icon: 'warning', title: 'กรุณายืนยันตัวตน', text: 'โปรดยืนยันว่าไม่ใช่บอท (reCAPTCHA)' });
            return;
        }
        if (password !== confirmPassword) {
            Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ตรงกัน' });
            return;
        }
        if (!/^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(password)) {
            Swal.fire({ icon: 'error', title: 'รหัสผ่านไม่ถูกต้อง', text: 'อย่างน้อย 6 ตัว และต้องมีตัวอักษร/ตัวเลข' });
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            Swal.fire({ icon: 'error', title: 'อีเมลไม่ถูกต้อง' });
            return;
        }

        // map ฟิลด์ให้ตรง backend/db
        const payload = {
            title: fd.get('title') || '',
            first_name: fd.get('first_name') || '',
            last_name: fd.get('last_name') || '',
            national_id: fd.get('national_id') || '',
            phone: fd.get('phone') || '',
            address: fd.get('address') || '',
            province,
            birth_date: fd.get('birthdate') || '', // ฟอร์มเดิมชื่อ birthdate -> ส่งเป็น birth_date
            email, // emergency_email -> email (ให้ตรง backend)
            password,
            username: fd.get('username') || '', // ถ้าไม่ส่ง หลังบ้านจะ gen จากอีเมล
            ...(RECAPTCHA_KEY ? { captcha: captchaToken } : {})
        };
        setLoadingReg(true);
        try {
            const res = await fetch(`${API_BASE}/users/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result?.message || result?.error || 'สมัครสมาชิกไม่สำเร็จ');

            await Swal.fire({
                icon: result?.email_sent ? 'success' : 'warning',
                title: 'สมัครสมาชิกสำเร็จ',
                text: result?.email_sent ? 'กรุณากรอก OTP เพื่อยืนยันอีเมล' : 'ยังส่ง OTP ไม่สำเร็จ คุณสามารถกดส่งใหม่ในหน้าถัดไป',
            });
            router.push(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
        } catch (err: unknown) {
            captchaRef.current?.reset();
            setCaptchaToken(null);
            Swal.fire({ icon: 'error', title: 'สมัครสมาชิกไม่สำเร็จ', text: getErrorMessage(err, 'เกิดข้อผิดพลาด') });
        } finally {
            setLoadingReg(false);
        }
    };

    // ===== Login =====
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!loginUsername || !loginPassword) {
            Swal.fire({ icon: 'warning', title: 'กรอกข้อมูลให้ครบ', text: 'กรุณากรอกอีเมล/ชื่อผู้ใช้ และรหัสผ่าน' });
            return;
        }

        const identifier = loginUsername.trim();
        const body: LoginRequestBody = identifier.includes('@')
            ? { email: identifier, password: loginPassword, remember_me: rememberMe }
            : { username: identifier, password: loginPassword, remember_me: rememberMe };

        setLoadingLogin(true);
        try {
            const res = await fetch(`${API_BASE}/users/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (!res.ok) {
                if (result?.code === 'EMAIL_VERIFICATION_REQUIRED' && result?.email) {
                    router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
                }
                if (result?.code === 'ACCOUNT_INACTIVE') {
                    const status = String(result?.account_status || '').toLowerCase();
                    const title = status === 'deactivated'
                        ? 'บัญชีนี้ถูกหยุดใช้งานแล้ว'
                        : status === 'suspended'
                            ? 'บัญชีถูกระงับการใช้งาน'
                            : 'บัญชีนี้ยังไม่พร้อมใช้งาน';
                    await Swal.fire({
                        icon: 'warning',
                        title,
                        text: result?.error || 'กรุณาติดต่อคลินิกเพื่อตรวจสอบสถานะบัญชี',
                        footer: 'ติดต่อคลินิก: 086-856-8646 · clinic.piyaphan@gmail.com',
                        confirmButtonText: 'รับทราบ',
                        confirmButtonColor: '#0f9f8f',
                    });
                    return;
                }
                throw new Error(result?.error || result?.message || 'เข้าสู่ระบบไม่สำเร็จ');
            }

            // { token, user:{ user_id, username, email, role } }
            const role = String(result.user?.role || '').toLowerCase();
            const isUser = role === 'user' || role === 'users';
            Cookies.remove(isUser ? 'adminToken' : 'userToken');
            Cookies.set(isUser ? 'userToken' : 'adminToken', result.token, {
                sameSite: 'lax',
                secure: window.location.protocol === 'https:',
                ...(rememberMe ? { expires: 7 } : {})
            });

            localStorage.setItem('user', JSON.stringify(result.user));
            if (rememberMe) {
                localStorage.setItem('rememberedLoginIdentifier', identifier);
            } else {
                localStorage.removeItem('rememberedLoginIdentifier');
            }

            Swal.fire({ icon: 'success', title: 'เข้าสู่ระบบสำเร็จ', timer: 1200, showConfirmButton: false });

            // ส่งไปหน้า home ตาม role
            const roleHome: Record<string, string> = {
                super_admin: '/admin/dashboard',
                superadmin: '/admin/dashboard',
                admin: '/admin/dashboard',
                doctor: '/admin/dashboard',
                assistant: '/admin/dashboard',
                user: '/users/userHome',
                users: '/users/userHome'
            };
            setTimeout(() => router.push(roleHome[role] || '/'), 1300);
        } catch (err: unknown) {
            Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: getErrorMessage(err, 'เกิดข้อผิดพลาด') });
        } finally {
            setLoadingLogin(false);
        }
    };

    // ===== UI =====
    const loginForm = (
        <form className={styles.formStyle} onSubmit={handleLogin}>
            <h1 className={styles.formTitle}>เข้าสู่ระบบ</h1>

            <input
                type="text"
                name="username"
                autoComplete="username"
                placeholder="อีเมล หรือ ชื่อผู้ใช้"
                required
                className={styles.formInput}
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
            />

            <div className={styles.passwordInputWrapper}>
                <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder="รหัสผ่าน"
                    required
                    className={styles.formInput}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                />
                <button type="button" className={styles.togglePasswordIcon}
                    onClick={() => setShowPassword(prev => !prev)}
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    aria-pressed={showPassword}>
                    {showPassword ? <FaEye /> : <FaEyeSlash />}
                </button>
            </div>

            <div className={styles.loginOptions}>
                <div className={styles.rememberMeContainer}>
                    <input type="checkbox" id="rememberMe" className={styles.rememberMeCheckbox}
                        checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                    <label htmlFor="rememberMe" className={styles.rememberMeLabel}>จำรหัสผ่าน</label>
                </div>
                <Link href="/forgotpassword" className={styles.forgotPasswordLink}>ลืมรหัสผ่าน?</Link>
            </div>

            <div className={styles.socialLoginButtons}>
                <button type="button" onClick={handleGoogleLogin} className={styles.iconCircleButton}>
                    <FcGoogle size={40} />
                </button>
                <button type="button" onClick={handleLineLogin} className={styles.iconCircleButton}>
                    <FaLine size={40} color="#06C755" />
                </button>
            </div>

            <button type="submit" className={styles.formButton} disabled={loadingLogin}>
                {loadingLogin ? 'กำลังเข้าสู่ระบบ…' : 'Login'}
            </button>

            <Link href="/privacy-policy" className={styles.privacyLink}>
                นโยบายความเป็นส่วนตัว
            </Link>
        </form>
    );

    const registerForm = (
        <form id="registerForm" className={styles.formStyle} onSubmit={handleRegister}>
            <h1 className={styles.formTitle}>สมัครสมาชิก</h1>

            <select name="title" required className={styles.formInput}>
                <option value="">เลือกคำนำหน้า</option>
                <option value="นาย">นาย</option>
                <option value="นางสาว">นางสาว</option>
                <option value="นาง">นาง</option>
                <option value="เด็กชาย">เด็กชาย</option>
                <option value="เด็กหญิง">เด็กหญิง</option>
            </select>

            <input name="first_name" placeholder="ชื่อจริง" required className={styles.formInput} />
            <input name="last_name" placeholder="นามสกุล" required className={styles.formInput} />
            <input type="text" name="national_id" placeholder="เลขบัตรประชาชน" pattern="\d{13}" maxLength={13} required className={styles.formInput} />
            <input type="tel" name="phone" placeholder="เบอร์โทรศัพท์" required className={styles.formInput} />
            <textarea name="address" placeholder="ที่อยู่" rows={3} required className={styles.formInput} />

            <select
                name="province"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                required
                className={styles.formInput}
            >
                <option value="">เลือกจังหวัด</option>
                {provincesList.map((name) => (
                    <option key={name} value={name}>{name}</option>
                ))}
            </select>

            <ThaiDatePicker name="birthdate" required endYear={new Date().getFullYear()} />

            {/* อีเมล: ฟอร์มเดิมใช้ emergency_email แต่ backend ต้องการ email -> map แล้วตอนส่ง */}
            <input type="email" name="emergency_email" placeholder="อีเมล" required className={styles.formInput} />

            <div className={styles.passwordInputWrapper}>
                <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)"
                    required
                    className={styles.formInput}
                />
                <button type="button" className={styles.togglePasswordIcon}
                    onClick={() => setShowRegisterPassword(prev => !prev)}
                    aria-label={showRegisterPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    aria-pressed={showRegisterPassword}>
                    {showRegisterPassword ? <FaEye /> : <FaEyeSlash />}
                </button>
            </div>

            <input type="password" name="confirm_password" autoComplete="new-password"
                placeholder="ยืนยันรหัสผ่าน" required className={styles.formInput} />

            {RECAPTCHA_KEY ? (
                <div className={styles.recaptchaWrapper}>
                    <ReCAPTCHA
                        ref={captchaRef}
                        sitekey={RECAPTCHA_KEY}
                        onChange={(token) => setCaptchaToken(token)}
                        onExpired={() => setCaptchaToken(null)}
                        onErrored={() => setCaptchaToken(null)}
                    />
                </div>
            ) : (
                <small style={{ color: '#666' }}>
                    *ยังไม่ได้ตั้งค่า reCAPTCHA (กำหนด <code>NEXT_PUBLIC_RECAPTCHA_SITE_KEY</code> ใน <code>.env.local</code> เพื่อเปิดใช้งาน)
                </small>
            )}

            <div className={styles.socialLoginButtons} style={{ marginTop: 8 }}>
                <button type="button" onClick={handleGoogleLogin} className={styles.iconCircleButton}>
                    <FcGoogle size={34} />
                </button>
                <button type="button" onClick={handleLineLogin} className={styles.iconCircleButton}>
                    <FaLine size={34} color="#06C755" />
                </button>
            </div>

            <button type="submit" className={`${styles.formButton} ${styles.btnOval}`} disabled={loadingReg}>
                {loadingReg ? 'กำลังสมัคร…' : 'สมัครสมาชิก'}
            </button>

            <Link href="/privacy-policy" className={styles.privacyLink}>
                นโยบายความเป็นส่วนตัว
            </Link>
        </form>
    );

    return (
        <div className={`${styles.container} ${isSignUp && !isMobile ? styles.containerRightPanelActive : ''}`}>
            {isMobile ? (
                <div className={styles.mobileWrapper}>
                    <div className={styles.toggleButtons}>
                        <button
                            onClick={() => setIsSignUp(false)}
                            className={styles.formButton}
                            style={{
                                backgroundColor: isSignUp ? 'transparent' : '#000066',
                                color: isSignUp ? '#64748b' : '#fff'
                            }}
                        >
                            เข้าสู่ระบบ
                        </button>
                        <button
                            onClick={() => setIsSignUp(true)}
                            className={styles.formButton}
                            style={{
                                backgroundColor: isSignUp ? '#000066' : 'transparent',
                                color: isSignUp ? '#fff' : '#64748b'
                            }}
                        >
                            สมัครสมาชิก
                        </button>
                    </div>
                    <div className={styles.formContainer}>
                        {isSignUp ? registerForm : loginForm}
                    </div>
                </div>
            ) : (
                <>
                    <div className={`${styles.formContainer} ${styles.signUpContainer}`}>
                        {registerForm}
                    </div>
                    <div className={`${styles.formContainer} ${styles.signInContainer}`}>
                        {loginForm}
                    </div>
                    <div className={styles.overlayContainer}>
                        <div className={styles.overlay}>
                            <div className={`${styles.overlayPanel} ${styles.overlayLeft}`}>
                                <p className={styles.formTitle}>หากมีบัญชีอยู่แล้ว<br />กรุณาเข้าสู่ระบบ</p>
                                <button className={`${styles.formButton} ${styles.ghostButton}`} onClick={() => setIsSignUp(false)}>
                                    Login
                                </button>
                            </div>
                            <div className={`${styles.overlayPanel} ${styles.overlayRight}`}>
                                <h1 className={styles.formTitle}>สมัครสมาชิก</h1>
                                <button className={`${styles.formButton} ${styles.ghostButton}`} onClick={() => setIsSignUp(true)}>
                                    Register
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
