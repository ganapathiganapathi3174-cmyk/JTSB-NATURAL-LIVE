import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseChat } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function GroupedMessages({ messages, userId, onImageClick }) {
  const groups = useMemo(() => {
    const g = [];
    let lastDate = '';
    messages.forEach(m => {
      const dateKey = m.createdAt ? new Date(m.createdAt).toDateString() : '';
      if (dateKey !== lastDate) { g.push({ type: 'date', label: formatDateLabel(m.createdAt), key: dateKey }); lastDate = dateKey; }
      g.push({ type: 'msg', msg: m });
    });
    return g;
  }, [messages]);

  const isImageMsg = (text) => text && text.startsWith('[img]');

  return groups.map((item) => {
    if (item.type === 'date') {
      return <div key={item.key} className="text-center mb-sm mt-md"><span className="text-muted text-xs font-semibold" style={{ background: 'var(--surface-2)', padding: '0.2rem 0.75rem', borderRadius: 12 }}>{item.label}</span></div>;
    }
    const m = item.msg;
    const isSent = m.senderId === userId;
    return (
      <div key={m.id} style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start', marginBottom: '0.4rem' }}>
        <div className="glass-card" style={{
          maxWidth: '80%',
          padding: '0.5rem 0.75rem',
          background: isSent ? 'var(--accent)' : 'var(--surface)',
          color: isSent ? 'var(--text)' : 'inherit',
          borderBottomRightRadius: isSent ? '4px' : 'var(--radius)',
          borderBottomLeftRadius: isSent ? 'var(--radius)' : '4px',
        }}>
          {isImageMsg(m.messageText) ? (
            <img src={m.messageText.replace('[img]', '')} alt="Attachment"
              onClick={() => onImageClick?.(m.messageText.replace('[img]', ''))}
              style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, cursor: 'pointer', display: 'block' }} />
          ) : (
            <div className="text-sm">{m.messageText}</div>
          )}
          <div className="flex items-center gap-xs" style={{ justifyContent: 'flex-end', marginTop: '0.2rem' }}>
            <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>{m.createdAt ? formatTime(m.createdAt) : ''}</span>
            {isSent && (
              <span style={{ fontSize: '0.6rem', opacity: m.isRead ? 1 : 0.5 }}>
                {m.isRead ? '\u2713\u2713' : '\u2713'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  });
}

export default function UserChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [convo, setConvo] = useState(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attachFile, setAttachFile] = useState(null);
  const [attachPreview, setAttachPreview] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);

  const messagesEndRef = useRef(null);
  const unsubRef = useRef(null);
  const fileInputRef = useRef(null);
  const prevMsgCount = useRef(0);

  const userId = localStorage.getItem('fb_user_id');
  const userName = localStorage.getItem('fb_user_name') || '';
  const userEmail = localStorage.getItem('fb_user_email') || '';

  useEffect(() => {
    if (!userId) { navigate('/fb/login', { replace: true }); return; }
    FirebaseChat.ensureConvo(userId, userName, userEmail).catch(() => setError('Failed to load chat.'));
    const convoId = FirebaseChat.getConvoId(userId);
    unsubRef.current = FirebaseChat.subscribeToMessages(convoId, (msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
    const unsubConvo = FirebaseChat.subscribeToUserConvo(userId, (c) => setConvo(c));
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (unsubConvo) unsubConvo();
    };
  }, [userId, navigate, userName, userEmail]);

  useEffect(() => {
    if (messages.length > 0) {
      const unreadMsgs = messages.filter(m => m.receiverId === userId && !m.isRead);
      if (unreadMsgs.length > 0) FirebaseChat.markConvoAsRead(FirebaseChat.getConvoId(userId), userId);
    }
  }, [messages, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const valid = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!valid.includes(f.type)) { alert('Only images (JPEG, PNG, WebP, GIF) are supported.'); return; }
    if (f.size > 5 * 1024 * 1024) { alert('Image must be under 5MB.'); return; }
    setAttachFile(f);
    const reader = new FileReader();
    reader.onload = () => setAttachPreview(reader.result);
    reader.readAsDataURL(f);
  }

  function clearAttachment() { setAttachFile(null); setAttachPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }

  async function handleSend(e) {
    e.preventDefault();
    if ((!inputText.trim() && !attachFile) || sending) return;
    const rl = checkRateLimit('chat:user:' + userId, 10, 30000);
    if (!rl.allowed) return;
    setSending(true);
    setError('');
    try {
      let text = inputText.trim();
      if (attachPreview) text = '[img]' + attachPreview;
      await FirebaseChat.send({ senderId: userId, receiverId: 'admin', messageText: text });
      setInputText(''); clearAttachment();
    } catch (err) { setError('Failed to send: ' + (err.message || 'Unknown error')); }
    setSending(false);
  }

  function getLastSeen() {
    if (!convo?.updatedAt) return '';
    const diff = Date.now() - new Date(convo.updatedAt).getTime();
    if (diff < 60000) return 'Active now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(convo.updatedAt).toLocaleDateString();
  }

  return (
    <div className="page-wrap animate-fade-in-up" style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: '720px', margin: '0 auto' }}>
      {/* Chat Header */}
      <div className="glass-strong flex items-center gap mb-md" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', flexShrink: 0 }}>
        <button className="btn-ghost btn-sm" onClick={() => navigate('/fb/dashboard')}>
          {'\u2190'} Dashboard
        </button>
        <div className="flex flex-col items-center" style={{ flex: 1 }}>
          <div className="font-semibold text-sm text-gradient">Admin Chat</div>
          <div className="text-xs text-muted">{convo ? getLastSeen() : ''}</div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1" style={{ overflowY: 'auto', padding: '0 0.5rem' }}>
        {loading ? (
          <div className="flex flex-col items-center gap-md" style={{ padding: '2rem' }}>
            <div className="loading-spinner loading-spinner-lg" />
            <div className="loading-text">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <p className="empty-text">No messages yet.</p>
            <p className="text-muted text-sm">Send a message to start the conversation.</p>
          </div>
        ) : (
          <GroupedMessages messages={messages} userId={userId} onImageClick={(src) => setImageViewer(src)} />
        )}
        {error && <div className="text-sm text-center" style={{ padding: '0.5rem 1rem', color: 'var(--danger)' }}>{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="glass-strong flex items-center gap-sm" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFileSelect} />
        <button type="button" className="btn-ghost btn-sm" title="Attach image" onClick={() => fileInputRef.current?.click()}
          style={{ color: attachPreview ? 'var(--accent)' : '' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        {attachPreview && (
          <div onClick={clearAttachment} title="Remove" style={{ width: 32, height: 32, position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
            <img src={attachPreview} alt="Attachment" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />
            <span style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: 'white', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</span>
          </div>
        )}
        <input className="flex-1 field-glass" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} autoFocus style={{ border: 'none', background: 'var(--surface-2)', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius)', fontSize: '0.85rem' }} />
        <button type="submit" className="btn-primary btn-sm" disabled={(!inputText.trim() && !attachFile) || sending}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      {/* Image Viewer Modal */}
      {imageViewer && (
        <div className="modal-overlay" onClick={() => setImageViewer(null)}>
          <div className="modal" style={{ background: 'transparent', boxShadow: 'none', padding: 0 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setImageViewer(null)}>&times;</button>
            <img src={imageViewer} alt="Full size" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
          </div>
        </div>
      )}
    </div>
  );
}
