import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { messagesApi } from '../api/client';

function formatTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return timeStr;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return `Yesterday ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
  } catch {
    return '';
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'ACCEPTED':
      return 'bg-success text-white';
    case 'PENDING':
      return 'bg-warning text-dark';
    case 'COUNTERED':
      return 'bg-info text-dark';
    case 'REJECTED':
      return 'bg-secondary text-white';
    case 'WITHDRAWN':
      return 'bg-dark text-white border border-secondary';
    case 'CANCELLED_BY_SYSTEM':
      return 'bg-danger text-white';
    default:
      return 'bg-secondary text-white';
  }
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeParams = useParams();
  const navigate = useNavigate();

  // State
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Active thread selection
  // The identifier can come from route /messages/:id, query ?offerId=..., or ?transactionId=...
  const activeId =
    routeParams.id ||
    searchParams.get('offerId') ||
    searchParams.get('transactionId') ||
    null;

  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState('');

  // Sending message state
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  // Mobile navigation helper: show list or thread
  const [mobileView, setMobileView] = useState('list'); // 'list' | 'thread'

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const pollingRef = useRef(null);

  // Auto-scroll to bottom of message thread
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  // Fetch all conversations for the user
  const fetchConversations = useCallback(async (silent = false) => {
    if (!silent) setLoadingConversations(true);
    setConversationsError('');
    try {
      const res = await messagesApi.conversations();
      const list = res.data?.data || [];
      setConversations(list);
      return list;
    } catch (err) {
      if (!silent) {
        setConversationsError(
          err.response?.data?.error?.message || 'Failed to load conversations.'
        );
      }
      return [];
    } finally {
      if (!silent) setLoadingConversations(false);
    }
  }, []);

  // Fetch messages for a specific conversation thread
  const fetchThread = useCallback(async (convId, silent = false) => {
    if (!convId) {
      setLoadingThread(false);
      return;
    }
    if (!silent) setLoadingThread(true);
    setThreadError('');
    try {
      const isTx = Boolean(searchParams.get('transactionId'));
      const res = isTx && String(searchParams.get('transactionId')) === String(convId)
        ? await messagesApi.thread(null, { transactionId: convId })
        : await messagesApi.thread(convId);

      const fetchedMsgs = Array.isArray(res.data?.data) ? res.data.data : [];
      setMessages(fetchedMsgs);

      // Decrement/clear unread count locally for this conversation since backend marked them read
      setConversations((prev) =>
        prev.map((c) =>
          String(c.offerId) === String(convId) || (c.transactionId && String(c.transactionId) === String(convId))
            ? { ...c, unreadCount: 0 }
            : c
        )
      );

      if (!silent) {
        setTimeout(() => scrollToBottom(false), 50);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        setThreadError('🔒 Access Denied: You are not authorized to access this conversation.');
      } else if (status === 404) {
        setThreadError('⚠️ Conversation not found or has been removed.');
      } else {
        setThreadError(err.response?.data?.error?.message || 'Failed to load messages.');
      }
    } finally {
      // Ensure loading indicator is always cleared on both success and failure
      setLoadingThread(false);
    }
  }, [searchParams, scrollToBottom]);

  // Initial load of conversations
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Fetch thread whenever activeId changes
  useEffect(() => {
    if (activeId) {
      setMobileView('thread');
      fetchThread(activeId);
    } else {
      setActiveConversation(null);
      setMessages([]);
      setMobileView('list');
      setLoadingThread(false);
    }
  }, [activeId, fetchThread]);

  // Synchronize conversation metadata from loaded conversations list (separated from thread fetching to prevent infinite loops)
  useEffect(() => {
    if (activeId && conversations.length > 0) {
      const matched = conversations.find(
        (c) =>
          String(c.offerId) === String(activeId) ||
          (c.transactionId && String(c.transactionId) === String(activeId))
      );
      if (matched) {
        setActiveConversation(matched);
      } else {
        setActiveConversation((prev) =>
          prev && (String(prev.offerId) === String(activeId) || String(prev.transactionId) === String(activeId))
            ? prev
            : { offerId: activeId }
        );
      }
    }
  }, [activeId, conversations]);

  // Periodic polling for thread updates (every 5 seconds)
  useEffect(() => {
    if (!activeId) return;

    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(() => {
      fetchThread(activeId, true);
    }, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeId, fetchThread]);

  // Select a conversation from the list
  const handleSelectConversation = (conv) => {
    setActiveConversation(conv);
    setSearchParams({ offerId: conv.offerId });
    setMobileView('thread');
    setSendError('');
    setInputMessage('');
  };

  // Back to list on mobile
  const handleBackToList = () => {
    setMobileView('list');
    setSearchParams({});
    setActiveConversation(null);
  };

  // Send message handler
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const trimmed = inputMessage.trim();
    if (!trimmed || sending || !activeId) return;

    if (trimmed.length > 5000) {
      setSendError('Message cannot exceed 5000 characters.');
      return;
    }

    setSending(true);
    setSendError('');

    try {
      const isTx = Boolean(
        searchParams.get('transactionId') &&
        String(searchParams.get('transactionId')) === String(activeId)
      );

      const res = isTx
        ? await messagesApi.send(null, { messageText: trimmed }, { transactionId: activeId })
        : await messagesApi.send(activeId, { messageText: trimmed });

      const newMsg = res.data?.data;

      // Optimistically append message to thread
      const appended = {
        id: newMsg?.id || Date.now(),
        senderId: user?.id,
        messageText: trimmed,
        isRead: false,
        sentAt: newMsg?.sentAt || new Date().toISOString(),
      };

      setMessages((prev) => [...prev, appended]);
      setInputMessage('');

      // Update conversations list's last message
      setConversations((prev) =>
        prev.map((c) => {
          if (
            String(c.offerId) === String(activeId) ||
            (c.transactionId && String(c.transactionId) === String(activeId))
          ) {
            return {
              ...c,
              lastMessage: appended,
            };
          }
          return c;
        })
      );

      setTimeout(() => scrollToBottom(true), 50);
      if (textareaRef.current) textareaRef.current.focus();
    } catch (err) {
      setSendError(
        err.response?.data?.error?.message || 'Failed to send message. Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  // Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Filter conversations based on search box
  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const counterpartyMatch = c.counterparty?.fullName?.toLowerCase().includes(query);
    const listingMatch = c.listing?.title?.toLowerCase().includes(query);
    const lastMsgMatch = c.lastMessage?.messageText?.toLowerCase().includes(query);
    return counterpartyMatch || listingMatch || lastMsgMatch;
  });

  return (
    <div className="container py-4 fade-in-up">
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h2 style={{ fontWeight: 800, color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
            💬 Messages & Negotiation
          </h2>
          <p className="text-muted-cs mb-0" style={{ fontSize: '0.95rem' }}>
            Coordinate meetups, discuss trade proposals, and negotiate offer details securely.
          </p>
        </div>
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={() => {
            fetchConversations();
            if (activeId) fetchThread(activeId);
          }}
          title="Refresh conversations"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Main Messaging Container */}
      <div
        className="card"
        style={{
          minHeight: '620px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'row',
        }}
      >
        <div className="row g-0 w-100" style={{ minHeight: '620px' }}>
          {/* ───────────────────────────────────────────────────────────── */}
          {/* Left Panel: Conversation List */}
          {/* ───────────────────────────────────────────────────────────── */}
          <div
            className={`col-12 col-md-4 col-lg-4 d-flex flex-column ${
              mobileView === 'thread' ? 'd-none d-md-flex' : 'd-flex'
            }`}
            style={{
              borderRight: '1px solid var(--cs-border)',
              background: 'var(--cs-surface)',
            }}
          >
            {/* Conversations search & filter */}
            <div className="p-3" style={{ borderBottom: '1px solid var(--cs-border)' }}>
              <div className="input-group input-group-sm">
                <span
                  className="input-group-text"
                  style={{
                    background: 'var(--cs-surface2)',
                    borderColor: 'var(--cs-border)',
                    color: 'var(--cs-text-dim)',
                  }}
                >
                  🔍
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search chats by name or item…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                />
                {searchQuery && (
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setSearchQuery('')}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Conversations List Scrollable Container */}
            <div
              className="flex-grow-1 overflow-auto"
              style={{ maxHeight: '560px' }}
            >
              {loadingConversations ? (
                <div className="p-4 text-center">
                  <div className="spinner-border spinner-border-sm text-primary mb-2" role="status" />
                  <div className="text-dim" style={{ fontSize: '0.85rem' }}>
                    Loading conversations…
                  </div>
                </div>
              ) : conversationsError ? (
                <div className="p-3 text-center">
                  <div className="alert alert-danger p-2 mb-0" style={{ fontSize: '0.82rem' }}>
                    {conversationsError}
                  </div>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-4 text-center text-muted-cs">
                  <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>📭</div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--cs-text)' }}>
                    {searchQuery ? 'No matching conversations' : 'No conversations yet'}
                  </div>
                  <p className="text-dim mb-0 mt-1" style={{ fontSize: '0.8rem' }}>
                    {searchQuery
                      ? 'Try another search term.'
                      : 'When you submit an offer or receive one on your listings, chats will appear here.'}
                  </p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = String(conv.offerId) === String(activeId);
                  const counterpartyInitial =
                    conv.counterparty?.fullName?.[0]?.toUpperCase() || '?';

                  return (
                    <div
                      key={conv.offerId}
                      onClick={() => handleSelectConversation(conv)}
                      className="p-3 d-flex align-items-start gap-3"
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--cs-border)',
                        background: isSelected
                          ? 'rgba(99,102,241,0.12)'
                          : 'transparent',
                        borderLeft: isSelected
                          ? '3px solid var(--cs-primary)'
                          : '3px solid transparent',
                        transition: 'var(--cs-transition)',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      {/* Avatar */}
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--cs-primary), var(--cs-primary-dark))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '1rem',
                          flexShrink: 0,
                        }}
                      >
                        {counterpartyInitial}
                      </div>

                      {/* Info & Snippet */}
                      <div className="flex-grow-1 overflow-hidden">
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <span
                            style={{
                              fontWeight: isSelected ? 700 : 600,
                              color: 'var(--cs-text)',
                              fontSize: '0.92rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '140px',
                            }}
                          >
                            {conv.counterparty?.fullName || 'Campus Peer'}
                          </span>
                          <span
                            className="text-dim"
                            style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                          >
                            {formatTimestamp(conv.lastMessage?.sentAt)}
                          </span>
                        </div>

                        {/* Listing Title & Offer Status */}
                        <div className="d-flex align-items-center gap-1 mb-1">
                          <span
                            className="text-muted-cs"
                            style={{
                              fontSize: '0.78rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '150px',
                            }}
                          >
                            📦 {conv.listing?.title || `Listing #${conv.listing?.id}`}
                          </span>
                          {conv.offerStatus && (
                            <span
                              className={`badge ${getStatusBadgeClass(conv.offerStatus)}`}
                              style={{ fontSize: '0.62rem', padding: '0.2em 0.45em' }}
                            >
                              {conv.offerStatus}
                            </span>
                          )}
                        </div>

                        {/* Last Message Snippet */}
                        <div className="d-flex align-items-center justify-content-between">
                          <span
                            className="text-dim"
                            style={{
                              fontSize: '0.8rem',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '180px',
                              fontStyle: conv.lastMessage ? 'normal' : 'italic',
                            }}
                          >
                            {conv.lastMessage?.messageText || 'No messages yet'}
                          </span>

                          {/* Unread Badge */}
                          {conv.unreadCount > 0 && (
                            <span
                              className="badge rounded-pill bg-primary"
                              style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
                            >
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ───────────────────────────────────────────────────────────── */}
          {/* Right Panel: Conversation Thread */}
          {/* ───────────────────────────────────────────────────────────── */}
          <div
            className={`col-12 col-md-8 col-lg-8 d-flex flex-column ${
              mobileView === 'list' ? 'd-none d-md-flex' : 'd-flex'
            }`}
            style={{ background: 'var(--cs-bg)' }}
          >
            {activeId ? (
              <>
                {/* Thread Header */}
                <div
                  className="p-3 d-flex align-items-center justify-content-between flex-wrap gap-2"
                  style={{
                    borderBottom: '1px solid var(--cs-border)',
                    background: 'var(--cs-surface)',
                  }}
                >
                  <div className="d-flex align-items-center gap-3">
                    {/* Mobile Back Button */}
                    <button
                      className="btn btn-sm btn-outline-secondary d-md-none"
                      onClick={handleBackToList}
                    >
                      ← Back
                    </button>

                    <div>
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--cs-text)' }}>
                          {activeConversation?.counterparty?.fullName || 'Peer Discussion'}
                        </span>
                        {activeConversation?.offerStatus && (
                          <span
                            className={`badge ${getStatusBadgeClass(
                              activeConversation.offerStatus
                            )}`}
                            style={{ fontSize: '0.68rem' }}
                          >
                            {activeConversation.offerStatus}
                          </span>
                        )}
                      </div>

                      {activeConversation?.listing && (
                        <div style={{ fontSize: '0.82rem' }}>
                          <span className="text-muted-cs">Relating to: </span>
                          <Link
                            to={`/listings/${activeConversation.listing.id}`}
                            className="text-primary-light"
                            style={{ textDecoration: 'none' }}
                          >
                            {activeConversation.listing.title} ↗
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions / Info */}
                  <div className="d-flex align-items-center gap-2">
                    {activeConversation?.listing?.id && (
                      <Link
                        to={`/listings/${activeConversation.listing.id}`}
                        className="btn btn-outline-primary btn-sm"
                        style={{ fontSize: '0.8rem' }}
                      >
                        View Item
                      </Link>
                    )}
                  </div>
                </div>

                {/* Error Banner */}
                {threadError && (
                  <div className="p-3">
                    <div className="alert alert-danger mb-0" style={{ fontSize: '0.88rem' }}>
                      {threadError}
                    </div>
                  </div>
                )}

                {/* Messages Scroll Area */}
                <div
                  className="flex-grow-1 p-3 overflow-auto d-flex flex-column gap-2"
                  style={{
                    maxHeight: '440px',
                    minHeight: '380px',
                    background: 'rgba(0,0,0,0.15)',
                  }}
                >
                  {loadingThread ? (
                    <div className="m-auto text-center py-5">
                      <div className="spinner-border text-primary mb-2" role="status" />
                      <div className="text-dim" style={{ fontSize: '0.88rem' }}>
                        Loading message thread…
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="m-auto text-center py-5 text-muted-cs">
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>💬</div>
                      <div style={{ fontWeight: 600, color: 'var(--cs-text)' }}>
                        No messages in this conversation yet
                      </div>
                      <p className="text-dim mb-0 mt-1" style={{ fontSize: '0.85rem' }}>
                        Send a message below to discuss price, barter items, or arrange a safe campus meetup.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMine = msg.senderId === user?.id;

                      return (
                        <div
                          key={msg.id}
                          className="d-flex flex-column"
                          style={{
                            alignItems: isMine ? 'flex-end' : 'flex-start',
                            marginBottom: '0.4rem',
                          }}
                        >
                          {/* Bubble */}
                          <div
                            className={`msg-bubble ${isMine ? 'mine' : 'theirs'}`}
                            style={{
                              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                            }}
                          >
                            {msg.messageText}
                          </div>

                          {/* Metadata: Timestamp & Read Receipt */}
                          <div
                            className="d-flex align-items-center gap-1 mt-1 px-1 text-dim"
                            style={{ fontSize: '0.72rem' }}
                          >
                            <span>{formatTimestamp(msg.sentAt)}</span>
                            {isMine && (
                              <span>
                                • {msg.isRead ? (
                                  <span style={{ color: 'var(--cs-primary-light)' }} title="Read by counterparty">
                                    ✓✓ Read
                                  </span>
                                ) : (
                                  <span title="Delivered">✓ Sent</span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Send Error Notice */}
                {sendError && (
                  <div className="px-3 pt-2">
                    <div className="alert alert-danger py-1 px-2 mb-0" style={{ fontSize: '0.82rem' }}>
                      {sendError}
                    </div>
                  </div>
                )}

                {/* Input Bar */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 d-flex align-items-end gap-2"
                  style={{
                    borderTop: '1px solid var(--cs-border)',
                    background: 'var(--cs-surface)',
                  }}
                >
                  <div className="flex-grow-1 position-relative">
                    <textarea
                      ref={textareaRef}
                      className="form-control"
                      rows={2}
                      placeholder="Type a message… (Press Enter to send, Shift+Enter for newline)"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      maxLength={5000}
                      disabled={sending || !!threadError}
                      style={{
                        resize: 'none',
                        fontSize: '0.9rem',
                        paddingRight: '45px',
                      }}
                    />
                    <div
                      className="position-absolute text-dim"
                      style={{
                        bottom: '6px',
                        right: '12px',
                        fontSize: '0.7rem',
                        pointerEvents: 'none',
                      }}
                    >
                      {inputMessage.length > 4000 ? `${inputMessage.length}/5000` : ''}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary d-flex align-items-center justify-content-center"
                    style={{
                      height: '48px',
                      padding: '0 1.25rem',
                      borderRadius: 'var(--cs-radius-sm)',
                      fontWeight: 600,
                    }}
                    disabled={!inputMessage.trim() || sending || !!threadError}
                  >
                    {sending ? (
                      <span className="spinner-border spinner-border-sm" role="status" />
                    ) : (
                      <>
                        <span className="d-none d-sm-inline me-1">Send</span>
                        <span>➤</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* No Thread Selected State */
              <div className="m-auto text-center p-5 text-muted-cs" style={{ maxWidth: 460 }}>
                <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>💬</div>
                <h4 style={{ color: 'var(--cs-text)', fontWeight: 700 }}>
                  Select a Conversation
                </h4>
                <p className="text-dim mb-4" style={{ fontSize: '0.92rem' }}>
                  Choose a chat from the sidebar on the left to coordinate negotiations, finalize meetup locations, and confirm exchange terms.
                </p>
                <div className="p-3 rounded text-start" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--cs-text)', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                    💡 Safety Tips for Meetups:
                  </div>
                  <ul className="text-dim mb-0 ps-3" style={{ fontSize: '0.8rem' }}>
                    <li>Meet in broad daylight at popular campus spots (Library, Student Union).</li>
                    <li>Inspect textbook editions and electronic conditions before handing over cash.</li>
                    <li>Mark the transaction complete in CampusSwap once handed over.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
