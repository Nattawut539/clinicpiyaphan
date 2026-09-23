'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, MessageCircle, Minimize2, Minus, Send, X } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import Cookies from '@/lib/cookies';
import styles from './ClinicChat.module.css';

type Conversation = { patient_user_id: number; first_name: string; last_name: string; last_message: string; last_message_at: string; unread_count: number };
type Message = { message_id: number; sender_user_id: number; sender_first_name: string; sender_last_name: string; sender_role: string; body: string; created_at: string };
type Draft = { text: string; clientId: string };
type Api = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
const staffRoles = new Set(['admin', 'doctor', 'super_admin', 'superadmin']);
const fullName = (first: string, last: string) => [first, last].filter(Boolean).join(' ');
const time = (value: string) => new Date(value).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'เชื่อมต่อแชทไม่สำเร็จ';

export default function ClinicChat({ staff = false }: { staff?: boolean }) {
    const [identity, setIdentity] = useState<number | null>(null);
    const [mode, setMode] = useState<'hidden' | 'minimized' | 'open'>('hidden');
    const [expanded, setExpanded] = useState(false);
    const [selected, setSelected] = useState<Conversation | null>(null);
    const [drafts, setDrafts] = useState<Record<number, Draft>>({});
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [unread, setUnread] = useState(0);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [more, setMore] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);
    const api = useCallback<Api>(async <T,>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
        const token = Cookies.get(staff ? 'adminToken' : 'userToken');
        const response = await fetch(`${API_BASE}${path}`, {
            method: body === undefined ? 'GET' : 'POST', credentials: 'include', cache: 'no-store',
            headers: { Authorization: `Bearer ${token || ''}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 401 ? 'กรุณาเข้าสู่ระบบใหม่' : data.message || data.error || 'แชทยังไม่พร้อมใช้งาน กรุณาลองอีกครั้ง');
        return data as T;
    }, [staff]);

    useEffect(() => {
        const controller = new AbortController();
        api<{ user_id: number; role: string; medical_consent: boolean }>('/users/me', undefined, controller.signal).then((session) => {
            if (staff ? !staffRoles.has(session.role) : !['user', 'users'].includes(session.role) || !session.medical_consent) return;
            setIdentity(Number(session.user_id));
            try {
                const saved = JSON.parse(sessionStorage.getItem(`clinic-chat:${session.user_id}`) || '{}');
                if (['hidden', 'minimized', 'open'].includes(saved.mode)) setMode(saved.mode);
                setExpanded(Boolean(saved.expanded));
            } catch { /* Browser storage may be disabled. */ }
        }).catch(() => { /* The surrounding authenticated layout handles sign-in. */ });
        return () => controller.abort();
    }, [api, staff]);

    useEffect(() => {
        if (!identity) return;
        try { sessionStorage.setItem(`clinic-chat:${identity}`, JSON.stringify({ mode, expanded })); } catch { /* Optional UI preference only. */ }
    }, [identity, mode, expanded]);

    useEffect(() => {
        if (!identity) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        async function poll() {
            if (controller.signal.aborted) return;
            try {
                if (document.visibilityState === 'visible') {
                    const data = await api<{ conversations: Conversation[]; unread_total: number; has_more: boolean }>(`/chat/conversations?page=${page}&search=${encodeURIComponent(search)}`, undefined, controller.signal);
                    if (controller.signal.aborted) return;
                    setConversations(data.conversations); setUnread(data.unread_total); setMore(data.has_more); setError(''); setLoading(false);
                }
            } catch (cause) { if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false); } }
            if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
        }
        const debounce = setTimeout(poll, 200);
        return () => { controller.abort(); clearTimeout(timer); clearTimeout(debounce); };
    }, [api, identity, page, search, refresh]);

    const updateDraft = useCallback((id: number, value: Draft | ((old: Draft) => Draft)) => {
        setDrafts((current) => ({ ...current, [id]: typeof value === 'function' ? value(current[id] || { text: '', clientId: '' }) : value }));
    }, []);
    if (!identity) return null;
    const threadId = staff ? selected?.patient_user_id : identity;
    const title = staff ? selected ? fullName(selected.first_name, selected.last_name) || `ผู้ใช้ #${threadId}` : 'ข้อความจากผู้ใช้' : 'แชทกับคลินิก';
    return <aside className={styles.widget} aria-label="แชทคลินิก">
        {mode === 'hidden' && <button className={styles.launcher} onClick={() => setMode('open')} aria-label={`เปิดแชท${unread ? ` มี ${unread} ข้อความยังไม่อ่าน` : ''}`}><MessageCircle size={23} /><span>แชท</span>{unread > 0 && <b className={styles.badge}>{unread > 99 ? '99+' : unread}</b>}</button>}
        <section className={`${styles.panel} ${expanded ? styles.expanded : ''}`} style={{ display: mode === 'hidden' ? 'none' : undefined }} aria-label={title}>
            <header className={styles.header}>
                {staff && selected && <button aria-label="กลับไปรายชื่อ" onClick={() => setSelected(null)}><ArrowLeft size={18} /></button>}
                <button className={styles.title} onClick={() => setMode(mode === 'minimized' ? 'open' : 'minimized')}>{title}{unread > 0 && <b className={styles.badge}>{unread}</b>}</button>
                <button aria-label={expanded ? 'ลดขนาดแชท' : 'ขยายแชท'} onClick={() => { setExpanded(!expanded); setMode('open'); }}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
                <button aria-label={mode === 'minimized' ? 'เปิดบทสนทนา' : 'ย่อแชท'} onClick={() => setMode(mode === 'minimized' ? 'open' : 'minimized')}><Minus size={18} /></button>
                <button aria-label="ซ่อนแชท" onClick={() => setMode('hidden')}><X size={19} /></button>
            </header>
            <div style={{ display: mode === 'open' ? undefined : 'none' }}>
                {staff && !selected ? <div className={styles.inbox}>
                    <input aria-label="ค้นหาผู้ส่งข้อความ" placeholder="ค้นหาชื่อ–นามสกุล" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
                    {error && <p role="status" className={styles.error}>{error} <button onClick={() => setRefresh((n) => n + 1)}>ลองใหม่</button></p>}
                    {loading ? <p className={styles.empty}>กำลังโหลดข้อความ...</p> : !conversations.length && !error ? <p className={styles.empty}>ยังไม่มีบทสนทนาในรายการนี้</p> : null}
                    <div className={styles.conversations}>{conversations.map((conversation) => <button key={conversation.patient_user_id} className={styles.conversation} onClick={() => setSelected(conversation)}>
                        <span className={styles.avatar}>{conversation.first_name?.charAt(0) || 'ผ'}</span><span className={styles.preview}><strong>{fullName(conversation.first_name, conversation.last_name) || `ผู้ใช้ #${conversation.patient_user_id}`}</strong><span>{conversation.last_message}</span><time>{time(conversation.last_message_at)}</time></span>{conversation.unread_count > 0 && <b className={styles.badge}>{conversation.unread_count}</b>}
                    </button>)}</div>
                    <div className={styles.pages}><button disabled={page === 0} onClick={() => setPage(page - 1)}>ก่อนหน้า</button><span>หน้า {page + 1}</span><button disabled={!more} onClick={() => setPage(page + 1)}>ถัดไป</button></div>
                </div> : threadId && <ChatThread key={threadId} id={threadId} viewer={identity} staff={staff} api={api} active={mode === 'open'} draft={drafts[threadId] || { text: '', clientId: '' }} updateDraft={updateDraft} onRead={() => setRefresh((n) => n + 1)} />}
            </div>
        </section>
    </aside>;
}

function ChatThread({ id, viewer, staff, api, active, draft, updateDraft, onRead }: {
    id: number; viewer: number; staff: boolean; api: Api; active: boolean; draft: Draft;
    updateDraft: (id: number, value: Draft | ((old: Draft) => Draft)) => void; onRead: () => void;
}) {
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesRef = useRef<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [older, setOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [sending, setSending] = useState(false);
    const sendLock = useRef(false);
    const [error, setError] = useState('');
    const [sendError, setSendError] = useState('');
    const [readThrough, setReadThrough] = useState(0);
    const [tick, setTick] = useState(0);
    const [atBottom, setAtBottom] = useState(true);
    const scroll = useRef<HTMLDivElement>(null);
    const composerInput = useRef<HTMLTextAreaElement>(null);
    const nearBottom = useRef(true);
    const readSent = useRef(0);
    const onReadRef = useRef(onRead);
    onReadRef.current = onRead;
    const merge = useCallback((items: Message[]) => {
        const map = new Map(messagesRef.current.map((message) => [message.message_id, message]));
        items.forEach((message) => map.set(message.message_id, message));
        messagesRef.current = [...map.values()].sort((a, b) => a.message_id - b.message_id);
        setMessages(messagesRef.current);
    }, []);

    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        async function poll() {
            if (controller.signal.aborted) return;
            let more = false;
            try {
                if (document.visibilityState === 'visible') {
                    const last = messagesRef.current.at(-1)?.message_id;
                    const data = await api<{ messages: Message[]; has_more: boolean; read_through: number }>(`/chat/${id}/messages${last ? `?after=${last}` : ''}`, undefined, controller.signal);
                    if (controller.signal.aborted) return;
                    merge(data.messages); setReadThrough(data.read_through); setError(''); setLoading(false);
                    if (!last) setOlder(data.has_more); else more = data.has_more;
                    if (nearBottom.current) requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
                    const newest = messagesRef.current.at(-1)?.message_id || 0;
                    if (nearBottom.current && document.hasFocus() && newest > readSent.current) {
                        await api(`/chat/${id}/read`, { message_id: newest }, controller.signal);
                        readSent.current = newest; onReadRef.current();
                    }
                }
            } catch (cause) { if (!controller.signal.aborted) { setError(errorText(cause)); setLoading(false); } }
            if (!controller.signal.aborted) timer = setTimeout(poll, more ? 100 : 3000);
        }
        void poll();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [id, active, api, merge, tick]);

    async function loadOlder() {
        if (loadingOlder || !messages[0]) return;
        setLoadingOlder(true);
        const previousHeight = scroll.current?.scrollHeight || 0;
        try {
            const data = await api<{ messages: Message[]; has_more: boolean }>(`/chat/${id}/messages?before=${messages[0].message_id}`);
            merge(data.messages); setOlder(data.has_more);
            requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop += scroll.current.scrollHeight - previousHeight; });
        } catch (cause) { setError(errorText(cause)); } finally { setLoadingOlder(false); }
    }
    async function send() {
        if (sendLock.current || !draft.text.trim()) return;
        sendLock.current = true; setSending(true); setSendError('');
        const pending = draft;
        try {
            await api(`/chat/${id}/messages`, { body: pending.text, client_id: pending.clientId });
            updateDraft(id, (current) => current.clientId === pending.clientId ? { text: '', clientId: '' } : current);
            nearBottom.current = true; setAtBottom(true); setTick((n) => n + 1);
        } catch (cause) { setSendError(`${errorText(cause)} — ข้อความยังอยู่ในช่องพิมพ์ กดส่งเพื่อลองอีกครั้ง`); }
        finally {
            sendLock.current = false; setSending(false);
            requestAnimationFrame(() => {
                if (document.activeElement === document.body && composerInput.current?.getClientRects().length) composerInput.current.focus({ preventScroll: true });
            });
        }
    }
    return <div className={styles.thread}>
        <p className={styles.note}>{staff ? 'ตอบกลับในนามทีมคลินิก · แสดงชื่อผู้ตอบแต่ละข้อความ' : 'ส่งข้อความถึงทีมคลินิก เจ้าหน้าที่จะตอบเมื่อพร้อมให้บริการ'}</p>
        {error && <p role="status" className={styles.error}>{error} <button onClick={() => setTick((n) => n + 1)}>ลองใหม่</button></p>}
        <div ref={scroll} className={styles.messages} role="log" aria-label="ข้อความสนทนา" aria-live="polite" onScroll={() => { const el = scroll.current; if (el) { nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 45; setAtBottom(nearBottom.current); } }}>
            {older && <button className={styles.older} onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? 'กำลังโหลด...' : 'โหลดข้อความก่อนหน้า'}</button>}
            {loading ? <p className={styles.empty}>กำลังโหลดบทสนทนา...</p> : !messages.length && <p className={styles.empty}>เริ่มสนทนาโดยพิมพ์ข้อความด้านล่าง</p>}
            {messages.map((message) => { const mine = message.sender_user_id === viewer; const team = staffRoles.has(message.sender_role); return <div key={message.message_id} className={`${styles.message} ${mine ? styles.mine : ''}`}>
                <small>{fullName(message.sender_first_name, message.sender_last_name) || (team ? 'ทีมคลินิก' : 'ผู้ใช้')}{team ? ' · เจ้าหน้าที่' : ''}</small>
                <p>{message.body}</p><time>{time(message.created_at)}{mine ? message.message_id <= readThrough ? ' · อ่านแล้ว' : ' · ส่งแล้ว' : ''}</time>
            </div>; })}
        </div>
        {!atBottom && <button className={styles.older} onClick={() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; nearBottom.current = true; setAtBottom(true); }}>ไปข้อความล่าสุด ↓</button>}
        {sendError && <p className={styles.error} role="alert">{sendError}</p>}
        <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea ref={composerInput} aria-label="พิมพ์ข้อความ" placeholder="พิมพ์ข้อความ…" maxLength={4000} value={draft.text} disabled={sending} rows={2} onChange={(event) => updateDraft(id, { text: event.target.value, clientId: crypto.randomUUID() })} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} />
            <button type="submit" disabled={sending || !draft.text.trim()} aria-label={sending ? 'กำลังส่งข้อความ' : 'ส่งข้อความ'}><Send size={20} /></button>
            <small>Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · {draft.text.length}/4000{sending ? ' · กำลังส่ง...' : ''}</small>
        </form>
    </div>;
}
