import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';
import { FirebaseUser, FirebaseChat } from '../db/firebase-db.js';
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

function GroupedMessages({ messages, onImageClick }) {
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
      return <div key={item.key} className="chat-date-divider"><span>{item.label}</span></div>;
    }
    const m = item.msg;
    return (
      <div key={m.id} className={`chat-bubble ${m.senderId === 'admin' ? 'chat-bubble-sent' : 'chat-bubble-received'}`}>
        {isImageMsg(m.messageText) ? (
          <img src={m.messageText.replace('[img]', '')} alt="Attachment" className="chat-bubble-image"
            onClick={() => onImageClick?.(m.messageText.replace('[img]', ''))}
            style={{ maxWidth: 220, maxHeight: 220, borderRadius: 8, cursor: 'pointer', display: 'block' }} />
        ) : (
          <div className="chat-bubble-text">{m.messageText}</div>
        )}
        <div className="chat-bubble-meta">
          <span className="chat-bubble-time">{m.createdAt ? formatTime(m.createdAt) : ''}</span>
          {m.senderId === 'admin' && (
            <span className={`chat-bubble-status ${m.isRead ? 'read' : ''}`}>
              {m.isRead ? '\u2713\u2713' : '\u2713'}
            </span>
          )}
        </div>
      </div>
    );
  });
}

export default function AdminChat() {
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadMap, setUnreadMap] = useState({});
  const [showSidebar, setShowSidebar] = useState(true);
  const [mobileView, setMobileView] = useState(window.innerWidth < 768);
  const [deleting, setDeleting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [attachFile, setAttachFile] = useState(null);
  const [attachPreview, setAttachPreview] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [typingText, setTypingText] = useState('');

  const adminName = localStorage.getItem('fb_admin_name') || 'Admin';
  const messagesEndRef = useRef(null);
  const unsubRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const fileInputRef = useRef(null);
  const prevMsgCount = useRef(0);
  const typingTimer = useRef(null);

  useEffect(() => {
    if (!localStorage.getItem('fb_admin_token')) { navigate('/fb-admin', { replace: true }); return; }
    const handleResize = () => setMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    const unsubUsers = FirebaseUser.subscribeToUsers((users) => setAllUsers(users || []));
    const unsubConvos = FirebaseChat.subscribeToAdminConvos((convos) => setConversations(convos || []));
    return () => {
      window.removeEventListener('resize', handleResize);
      if (unsubUsers) unsubUsers();
      if (unsubConvos) unsubConvos();
      if (unsubRef.current) unsubRef.current();
    };
  }, [navigate]);

  useEffect(() => {
    conversations.forEach(c => {
      FirebaseChat.getUnreadCount(c.userId).then(count => setUnreadMap(prev => ({ ...prev, [c.userId]: count })));
    });
  }, [conversations]);

  useEffect(() => {
    if (messages.length > prevMsgCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      playNotificationSound();
    }
    prevMsgCount.current = messages.length;
  }, [messages]);

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    const handle = () => {
      setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 300);
    };
    el.addEventListener('scroll', handle);
    return () => el.removeEventListener('scroll', handle);
  }, [messages]);

  useEffect(() => {
    if (!messages.length || !selectedUser) { setTypingText(''); return; }
    const last = [...messages].reverse().find(m => m.senderId !== 'admin');
    if (last) {
      const elapsed = Date.now() - new Date(last.createdAt).getTime();
      if (elapsed < 5000 && elapsed > 0) { setTypingText('typing...'); } else { setTypingText(''); }
    }
  }, [messages, selectedUser]);

  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 800; osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }

  function selectUser(user) {
    if (unsubRef.current) unsubRef.current();
    setSelectedUser(user); setMsgSearchQuery(''); setAttachFile(null); setAttachPreview(null);
    setImageViewer(null); setTypingText('');
    FirebaseChat.ensureConvo(user.id, user.name, user.email).then(() => {
      const convoId = FirebaseChat.getConvoId(user.id);
      unsubRef.current = FirebaseChat.subscribeToMessages(convoId, (msgs) => setMessages(msgs));
      FirebaseChat.markConvoAsRead(convoId, user.id);
    });
    if (mobileView) setShowSidebar(false);
  }

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
    if ((!inputText.trim() && !attachFile) || !selectedUser || sending) return;
    const rl = checkRateLimit('chat:admin:' + selectedUser.id, 10, 30000);
    if (!rl.allowed) return;
    setSending(true);
    try {
      let text = inputText.trim();
      if (attachPreview) { text = '[img]' + attachPreview; }
      await FirebaseChat.send({ senderId: 'admin', receiverId: selectedUser.id, messageText: text });
      setInputText(''); clearAttachment();
    } catch (err) { console.error('Send error:', err.message); }
    setSending(false);
  }

  async function handleDeleteChat() {
    if (!selectedUser || deleting) return;
    if (!window.confirm(`Delete entire chat with ${selectedUser.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await FirebaseChat.deleteUserChatData(selectedUser.id);
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      setSelectedUser(null); setMessages([]);
    } catch (err) { console.error('Delete chat error:', err.message); alert('Failed to delete chat: ' + err.message); }
    setDeleting(false);
  }

  async function handleCleanup() {
    if (cleaning) return;
    if (!window.confirm('Delete chat data for all deleted users? This cannot be undone.')) return;
    setCleaning(true);
    try { const count = await FirebaseChat.cleanupOrphanedConvos(); alert(`Cleaned up ${count} conversation(s).`); }
    catch (err) { console.error('Cleanup error:', err.message); alert('Cleanup failed: ' + err.message); }
    setCleaning(false);
  }

  const filteredUsers = searchQuery.trim()
    ? allUsers.filter(u => (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase())) || (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase())) || (u.id && u.id.toLowerCase().includes(searchQuery.toLowerCase())))
    : [];

  const convoUsers = conversations.map(c => {
    const user = allUsers.find(u => u.id === c.userId);
    return { ...c, user: user || { id: c.userId, name: c.userName || 'Unknown', email: c.userEmail || '' } };
  });

  const totalUnread = useMemo(() => Object.values(unreadMap).reduce((a, b) => a + b, 0), [unreadMap]);

  const filteredMsgs = useMemo(() => {
    if (!msgSearchQuery.trim()) return messages;
    const q = msgSearchQuery.toLowerCase();
    return messages.filter(m => m.messageText?.toLowerCase().includes(q));
  }, [messages, msgSearchQuery]);

  const userLastActive = useMemo(() => {
    if (!selectedUser) return '';
    const u = allUsers.find(x => x.id === selectedUser.id);
    return u?.lastActiveAt || '';
  }, [selectedUser, allUsers]);

  function getLastActiveDisplay() {
    if (!userLastActive) return 'Active';
    const diff = Date.now() - new Date(userLastActive).getTime();
    if (diff < 60000) return 'Active now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(userLastActive).toLocaleDateString();
  }

  return (
    <div className="fb-admin-layout">
      <AdminSidebar userName={adminName} pendingCounts={{}} />
      <main className="admin-main-content chat-main">
        <div className="chat-layout">
          <aside className={`chat-sidebar${!showSidebar ? ' chat-sidebar-hidden' : ''}`}>
            <div className="chat-sidebar-header">
              <h3>Messages {totalUnread > 0 && <span className="chat-unread" style={{ position: 'relative', top: '-1px', marginLeft: '0.35rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>{totalUnread > 9 ? '9+' : totalUnread}</span>}</h3>
              <button className="btn-icon btn-ghost" onClick={handleCleanup} title="Remove chats of deleted users" disabled={cleaning}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
            <div className="chat-search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chat-search-icon">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input className="chat-search-input" placeholder="Search users..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div className="chat-sidebar-list">
              {searchQuery.trim() ? (
                filteredUsers.map(u => (
                  <div key={u.id} className={`chat-user-item${selectedUser?.id === u.id ? ' active' : ''}`} onClick={() => { selectUser(u); setSearchQuery(''); }}>
                    <div className="chat-avatar">{u.name?.[0]?.toUpperCase() || '?'}</div>
                    <div className="chat-user-info">
                      <div className="chat-user-name">{u.name || 'Unknown'}</div>
                      <div className="chat-user-email">{u.email || ''}</div>
                    </div>
                  </div>
                ))
              ) : (
                convoUsers.map(c => (
                  <div key={c.userId} className={`chat-user-item${selectedUser?.id === c.userId ? ' active' : ''}`} onClick={() => { const u = allUsers.find(x => x.id === c.userId); if (u) selectUser(u); }}>
                    <div className="chat-avatar">{c.userName?.[0]?.toUpperCase() || '?'}</div>
                    <div className="chat-user-info">
                      <div className="chat-user-name">{c.userName || 'Unknown'}</div>
                      <div className="chat-user-preview">{c.lastSenderId === 'admin' ? 'You: ' : ''}{c.lastMessage?.replace('[img]', '')?.substring(0, 50) || ''}</div>
                    </div>
                    {unreadMap[c.userId] > 0 && <span className="chat-unread">{unreadMap[c.userId] > 9 ? '9+' : unreadMap[c.userId]}</span>}
                  </div>
                ))
              )}
              {!searchQuery.trim() && convoUsers.length === 0 && <div className="chat-empty-state">No conversations yet. Search for a user above to start chatting.</div>}
              {searchQuery.trim() && filteredUsers.length === 0 && <div className="chat-empty-state">No users found.</div>}
            </div>
          </aside>

          <div className="chat-main">
            {selectedUser ? (
              <>
                <div className="chat-header">
                  {mobileView && (
                    <button className="chat-back-btn" onClick={() => setShowSidebar(true)} title="Back">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                    </button>
                  )}
                  <div while-hover>
                    <div className="chat-header-avatar">{selectedUser.name?.[0]?.toUpperCase() || '?'}</div>
                  </div>
                  <div className="chat-header-info">
                    <div className="chat-header-name">{selectedUser.name || 'Unknown'}</div>
                    <div className="chat-header-status">{getLastActiveDisplay()}</div>
                  </div>
                  <div className="flex items-center gap-sm" style={{ marginLeft: 'auto' }}>
                    <button className="chat-delete-btn" onClick={handleDeleteChat} title="Delete entire chat" disabled={deleting}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  </div>
                </div>

                <div className="chat-search-box" style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-light)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input className="chat-search-input" placeholder="Search in conversation..." value={msgSearchQuery} onChange={e => setMsgSearchQuery(e.target.value)} style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }} />
                  {msgSearchQuery && <button className="btn-icon btn-ghost" onClick={() => setMsgSearchQuery('')} title="Clear search"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
                </div>

                <div className="chat-messages" ref={chatMessagesRef}>
                  {filteredMsgs.length === 0 ? (
                    <div className="chat-messages-empty">{msgSearchQuery ? 'No messages match your search.' : `Start a conversation with ${selectedUser.name}`}</div>
                  ) : (
                    <GroupedMessages messages={filteredMsgs} onImageClick={(src) => setImageViewer(src)} />
                  )}
                  {typingText && selectedUser && <div className="chat-typing-indicator">{selectedUser.name} is typing...</div>}
                  <div ref={messagesEndRef} />
                </div>

                {showScrollBtn && (
                  <button className="btn-primary btn-icon" onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })} title="Scroll to bottom">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                )}

                <form className="chat-input-box" onSubmit={handleSend}>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFileSelect} />
                  <button type="button" className="chat-attach-btn" title="Attach image" onClick={() => fileInputRef.current?.click()}
                    style={{ color: attachPreview ? 'var(--accent)' : '' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                  </button>
                  {attachPreview && (
                    <div className="chat-attach-preview" onClick={clearAttachment} title="Remove">
                      <img src={attachPreview} alt="Attachment" />
                      <span className="chat-attach-remove">&times;</span>
                    </div>
                  )}
                  <input className="chat-input-field" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} autoFocus />
                  <button type="submit" className="chat-send-btn" disabled={(!inputText.trim() && !attachFile) || sending}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                </form>
              </>
            ) : (
              <div className="chat-no-selection">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                <p>Select a conversation to start messaging</p>
              </div>
            )}
          </div>
        </div>

        {imageViewer && (
          <div className="modal-overlay" onClick={() => setImageViewer(null)}>
            <div className="chat-image-viewer" onClick={e => e.stopPropagation()}>
              <button className="chat-image-close" onClick={() => setImageViewer(null)}>&times;</button>
              <img src={imageViewer} alt="Full size" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
