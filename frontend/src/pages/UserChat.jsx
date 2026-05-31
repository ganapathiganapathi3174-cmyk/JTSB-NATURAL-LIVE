import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseChat } from '../db/firebase-db.js';

export default function UserChat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [convo, setConvo] = useState(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);
  const unsubRef = useRef(null);

  const userId = localStorage.getItem('fb_user_id');

  useEffect(() => {
    if (!userId) {
      navigate('/fb/login', { replace: true });
      return;
    }
    FirebaseChat.ensureConvo(userId, localStorage.getItem('fb_user_name') || '', '');
    const convoId = FirebaseChat.getConvoId(userId);
    unsubRef.current = FirebaseChat.subscribeToMessages(convoId, (msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
    const unsubConvo = FirebaseChat.subscribeToUserConvo(userId, (c) => {
      setConvo(c);
    });
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (unsubConvo) unsubConvo();
    };
  }, [userId, navigate]);

  useEffect(() => {
    if (messages.length > 0) {
      const unreadMsgs = messages.filter(m => m.receiverId === userId && !m.isRead);
      if (unreadMsgs.length > 0) {
        FirebaseChat.markConvoAsRead(FirebaseChat.getConvoId(userId), userId);
      }
    }
  }, [messages, userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    setSending(true);
    try {
      await FirebaseChat.send({ senderId: userId, receiverId: 'admin', messageText: inputText.trim() });
      setInputText('');
    } catch (err) {
      console.error('Send error:', err.message);
    }
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
            <p style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>Send a message to start the conversation.</p>
          </div>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`user-chat-row ${m.senderId === userId ? 'user-chat-row-sent' : 'user-chat-row-received'}`}>
              <div className={`user-chat-bubble ${m.senderId === userId ? 'user-chat-bubble-sent' : 'user-chat-bubble-received'}`}>
                <div className="user-chat-bubble-text">{m.messageText}</div>
                <div className="user-chat-bubble-meta">
                  <span className="user-chat-bubble-time">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                  {m.senderId === userId && (
                    <span className={`user-chat-bubble-status ${m.isRead ? 'read' : ''}`}>
                      {m.isRead ? '\u2713\u2713' : '\u2713'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="user-chat-input-box" onSubmit={handleSend}>
        <button type="button" className="user-chat-attach-btn" title="Attach file" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input className="user-chat-input-field" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} autoFocus />
        <button type="submit" className="user-chat-send-btn" disabled={!inputText.trim() || sending}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
