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
      return <div key={item.key} className="chat-date-divider" style={{ padding: '0.5rem 1rem', textAlign: 'center' }}><span style={{ background: 'var(--surface-2)', padding: '0.2rem 0.75rem', borderRadius: 12, fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 500 }}>{item.label}</span></div>;
    }
    const m = item.msg;
    const isSent = m.senderId === userId;
    return (
      <div key={m.id} className={`user-chat-row ${isSent ? 'user-chat-row-sent' : 'user-chat-row-received'}`}>
        <div className={`user-chat-bubble ${isSent ? 'user-chat-bubble-sent' : 'user-chat-bubble-received'}`}>
          {isImageMsg(m.messageText) ? (
            <img src={m.messageText.replace('[img]', '')} alt="Attachment" className="chat-bubble-image"
              onClick={() => onImageClick?.(m.messageText.replace('[img]', ''))}
              style={{ maxWidth: 200, maxHeight: 200, borderRadius: 8, cursor: 'pointer', display: 'block' }} />
          ) : (
            <div className="user-chat-bubble-text">{m.messageText}</div>
          )}
          <div className="user-chat-bubble-meta">
            <span className="user-chat-bubble-time">{m.createdAt ? formatTime(m.createdAt) : ''}</span>
            {isSent && (
              <span className={`user-chat-bubble-status ${m.isRead ? 'read' : ''}`}>
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
    <div className="user-chat-container">
      <div className="user-chat-header">
        <button className="btn-modern btn-modern-ghost btn-modern-sm" onClick={() => navigate('/fb/dashboard')}>
          {'\u2190'} Dashboard
        </button>
        <div className="user-chat-header-center">
          <div className="user-chat-header-title">Admin Chat</div>
          <div className="user-chat-header-status">{convo ? getLastSeen() : ''}</div>
        </div>
      </div>

      <div className="user-chat-messages">
        {loading ? (
          <div className="user-chat-empty">Loading messages...</div>
        ) : messages.length === 0 ? (
          <div className="user-chat-empty">
            <p style={{ margin: 0 }}>No messages yet.</p>
            <p style={{ fontSize: '0.85rem', marginTop: '0.3rem', color: 'var(--muted)' }}>Send a message to start the conversation.</p>
          </div>
        ) : (
          <GroupedMessages messages={messages} userId={userId} onImageClick={(src) => setImageViewer(src)} />
        )}
        {error && <div style={{ padding: '0.5rem 1rem', color: 'var(--danger)', fontSize: '0.85rem', textAlign: 'center' }}>{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <form className="user-chat-input-box" onSubmit={handleSend}>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFileSelect} />
        <button type="button" className="user-chat-attach-btn" title="Attach image" onClick={() => fileInputRef.current?.click()}
          style={{ color: attachPreview ? 'var(--accent)' : '' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        {attachPreview && (
          <div className="chat-attach-preview" onClick={clearAttachment} title="Remove" style={{ width: 32, height: 32 }}>
            <img src={attachPreview} alt="Attachment" />
            <span className="chat-attach-remove">&times;</span>
          </div>
        )}
        <input className="user-chat-input-field" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} autoFocus />
        <button type="submit" className="user-chat-send-btn" disabled={(!inputText.trim() && !attachFile) || sending}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      {imageViewer && (
        <div className="modal-overlay" onClick={() => setImageViewer(null)}>
          <div className="chat-image-viewer" onClick={e => e.stopPropagation()}>
            <button className="chat-image-close" onClick={() => setImageViewer(null)}>&times;</button>
            <img src={imageViewer} alt="Full size" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
          </div>
        </div>
      )}
    </div>
  );
}
