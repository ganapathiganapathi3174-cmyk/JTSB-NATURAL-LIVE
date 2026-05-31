import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';
import { FirebaseUser, FirebaseChat } from '../db/firebase-db.js';

export default function AdminChat() {
  const navigate = useNavigate();
  const [allUsers, setAllUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [unreadMap, setUnreadMap] = useState({});
  const [showSidebar, setShowSidebar] = useState(true);
  const [mobileView, setMobileView] = useState(window.innerWidth < 768);
  const messagesEndRef = useRef(null);
  const unsubRef = useRef(null);

  const adminName = localStorage.getItem('fb_admin_name') || 'Admin';

  useEffect(() => {
    if (!localStorage.getItem('fb_admin_token')) {
      navigate('/fb-admin', { replace: true });
      return;
    }
    const handleResize = () => setMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    const unsubUsers = FirebaseUser.subscribeToUsers((users) => {
      setAllUsers(users || []);
    });
    const unsubConvos = FirebaseChat.subscribeToAdminConvos((convos) => {
      setConversations(convos || []);
    });
    return () => {
      window.removeEventListener('resize', handleResize);
      if (unsubUsers) unsubUsers();
      if (unsubConvos) unsubConvos();
      if (unsubRef.current) unsubRef.current();
    };
  }, [navigate]);

  useEffect(() => {
    conversations.forEach(c => {
      FirebaseChat.getUnreadCount(c.userId).then(count => {
        setUnreadMap(prev => ({ ...prev, [c.userId]: count }));
      });
    });
  }, [conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function selectUser(user) {
    if (unsubRef.current) unsubRef.current();
    setSelectedUser(user);
    FirebaseChat.ensureConvo(user.id, user.name, user.email).then(() => {
      const convoId = FirebaseChat.getConvoId(user.id);
      unsubRef.current = FirebaseChat.subscribeToMessages(convoId, (msgs) => {
        setMessages(msgs);
      });
      FirebaseChat.markConvoAsRead(convoId, user.id);
    });
    if (mobileView) setShowSidebar(false);
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!inputText.trim() || !selectedUser || sending) return;
    setSending(true);
    try {
      await FirebaseChat.send({
        senderId: 'admin',
        receiverId: selectedUser.id,
        messageText: inputText.trim(),
      });
      setInputText('');
    } catch (err) {
      console.error('Send error:', err.message);
    }
    setSending(false);
  }

  const filteredUsers = searchQuery.trim()
    ? allUsers.filter(u =>
        (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (u.id && u.id.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const convoUsers = conversations.map(c => {
    const user = allUsers.find(u => u.id === c.userId);
    return { ...c, user: user || { id: c.userId, name: c.userName || 'Unknown', email: c.userEmail || '' } };
  });

  return (
    <div className="fb-admin-layout">
      <AdminSidebar userName={adminName} pendingCounts={{}} />
      <main className="admin-main-content chat-admin-main">
        <div className="chat-layout">
          <aside className={`chat-sidebar${!showSidebar ? ' chat-sidebar-hidden' : ''}`}>
            <div className="chat-sidebar-header">
              <h3>Messages</h3>
            </div>
            <div className="chat-search-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chat-search-icon">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input className="chat-search-input" placeholder="Search users..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div className="chat-user-list">
              {searchQuery.trim() ? (
                filteredUsers.map(u => (
                  <div key={u.id} className={`chat-user-item${selectedUser?.id === u.id ? ' active' : ''}`}
                    onClick={() => { selectUser(u); setSearchQuery(''); }}>
                    <div className="chat-user-avatar">{u.name?.[0]?.toUpperCase() || '?'}</div>
                    <div className="chat-user-info">
                      <div className="chat-user-name">{u.name || 'Unknown'}</div>
                      <div className="chat-user-email">{u.email || ''}</div>
                    </div>
                  </div>
                ))
              ) : (
                convoUsers.map(c => (
                  <div key={c.userId} className={`chat-user-item${selectedUser?.id === c.userId ? ' active' : ''}`}
                    onClick={() => { const u = allUsers.find(x => x.id === c.userId); if (u) selectUser(u); }}>
                    <div className="chat-user-avatar">{c.userName?.[0]?.toUpperCase() || '?'}</div>
                    <div className="chat-user-info">
                      <div className="chat-user-name">{c.userName || 'Unknown'}</div>
                      <div className="chat-user-preview">{c.lastSenderId === 'admin' ? 'You: ' : ''}{c.lastMessage}</div>
                    </div>
                    {unreadMap[c.userId] > 0 && (
                      <span className="chat-unread-badge">{unreadMap[c.userId] > 9 ? '9+' : unreadMap[c.userId]}</span>
                    )}
                  </div>
                ))
              )}
              {!searchQuery.trim() && convoUsers.length === 0 && (
                <div className="chat-empty-state">No conversations yet. Search for a user above to start chatting.</div>
              )}
              {searchQuery.trim() && filteredUsers.length === 0 && (
                <div className="chat-empty-state">No users found.</div>
              )}
            </div>
          </aside>

          <div className="chat-main">
            {selectedUser ? (
              <>
                <div className="chat-header">
                  {mobileView && (
                    <button className="chat-back-btn" onClick={() => setShowSidebar(true)} title="Back to conversations">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                      </svg>
                    </button>
                  )}
                  <div className="chat-header-avatar">{selectedUser.name?.[0]?.toUpperCase() || '?'}</div>
                  <div className="chat-header-info">
                    <div className="chat-header-name">{selectedUser.name || 'Unknown'}</div>
                    <div className="chat-header-status">
                      {(() => {
                        const c = conversations.find(x => x.userId === selectedUser.id);
                        if (c?.updatedAt) {
                          const diff = Date.now() - new Date(c.updatedAt).getTime();
                          if (diff < 60000) return 'Active now';
                          if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                          if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
                          return new Date(c.updatedAt).toLocaleDateString();
                        }
                        return 'Active';
                      })()}
                    </div>
                  </div>
                </div>

                <div className="chat-messages">
                  {messages.length === 0 ? (
                    <div className="chat-messages-empty">Start a conversation with {selectedUser.name}</div>
                  ) : (
                    messages.map(m => (
                      <div key={m.id} className={`chat-bubble ${m.senderId === 'admin' ? 'chat-bubble-sent' : 'chat-bubble-received'}`}>
                        <div className="chat-bubble-text">{m.messageText}</div>
                        <div className="chat-bubble-meta">
                          <span className="chat-bubble-time">{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</span>
                          {m.senderId === 'admin' && (
                            <span className={`chat-bubble-status ${m.isRead ? 'read' : ''}`}>
                              {m.isRead ? '\u2713\u2713' : '\u2713'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form className="chat-input-box" onSubmit={handleSend}>
                  <button type="button" className="chat-attach-btn" title="Attach file" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                  <input className="chat-input-field" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} autoFocus />
                  <button type="submit" className="chat-send-btn" disabled={!inputText.trim() || sending}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </form>
              </>
            ) : (
              <div className="chat-no-selection">
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <p>Select a conversation to start messaging</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
