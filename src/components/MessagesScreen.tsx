import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createGroupConversation,
  getMessages,
  listConversations,
  markConversationRead,
  sendMessage,
  type Conversation,
  type Message,
} from '@/lib/social/MessagingService';
import { subscribeToConversation } from '@/lib/social/SocialRealtime';
import { Icon } from '@/components/Icon';

interface MessagesScreenProps {
  initialConversationId: string | null;
}

function failureCopy(status: string): string {
  if (status === 'rate-limited') return 'Slow down before sending another message.';
  if (status === 'blocked') return 'This conversation is unavailable because someone is blocked.';
  if (status === 'forbidden') return 'You no longer have access to this conversation.';
  if (status === 'offline') return 'Messages are offline. Check your connection and retry.';
  return 'Messages could not complete that action.';
}

export function MessagesScreen({ initialConversationId }: MessagesScreenProps): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const visibleConversations = useMemo(() => {
    const query = conversationQuery.trim().toLocaleLowerCase();
    if (query === '') return conversations;
    return conversations.filter((item) => (item.title ?? 'Direct message').toLocaleLowerCase().includes(query));
  }, [conversationQuery, conversations]);

  async function refreshConversations(): Promise<void> {
    const result = await listConversations();
    setLoading(false);
    if (result.status === 'ok') {
      setConversations(result.data);
      setSelectedId((current) => current ?? result.data[0]?.id ?? null);
      setStatus(null);
    } else {
      setStatus(failureCopy(result.status));
    }
  }

  async function refreshMessages(id: string): Promise<void> {
    setLoadingMessages(true);
    const result = await getMessages(id);
    setLoadingMessages(false);
    if (result.status !== 'ok') {
      setStatus(failureCopy(result.status));
      return;
    }
    const ordered = [...result.data].sort((a, b) => a.seq - b.seq);
    setMessages(ordered);
    setHasOlder(result.data.length === 50);
    const latest = ordered.at(-1);
    if (latest !== undefined) void markConversationRead(id, latest.id).then(() => void refreshConversations());
    window.requestAnimationFrame(() => {
      const log = logRef.current;
      if (log !== null) log.scrollTop = log.scrollHeight;
    });
  }

  useEffect(() => { void refreshConversations(); }, []);
  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      return;
    }
    void refreshMessages(selectedId);
    return subscribeToConversation(selectedId, (change) => {
      const log = logRef.current;
      const nearBottom = log === null || log.scrollHeight - log.scrollTop - log.clientHeight < 120;
      setMessages((current) => {
        const without = current.filter((item) => item.id !== change.message.id);
        return [...without, change.message].sort((a, b) => a.seq - b.seq);
      });
      void markConversationRead(selectedId, change.message.id);
      if (nearBottom) window.requestAnimationFrame(() => { if (log !== null) log.scrollTop = log.scrollHeight; });
    });
  }, [selectedId]);

  async function loadOlder(): Promise<void> {
    if (selectedId === null || loadingOlder) return;
    const before = messages[0]?.seq ?? null;
    if (before === null) return;
    const log = logRef.current;
    const previousHeight = log?.scrollHeight ?? 0;
    setLoadingOlder(true);
    const result = await getMessages(selectedId, before);
    setLoadingOlder(false);
    if (result.status !== 'ok') {
      setStatus(failureCopy(result.status));
      return;
    }
    setMessages((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...result.data.filter((item) => !known.has(item.id)), ...current].sort((a, b) => a.seq - b.seq);
    });
    setHasOlder(result.data.length === 50);
    window.requestAnimationFrame(() => {
      if (log !== null) log.scrollTop = log.scrollHeight - previousHeight;
    });
  }

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (selectedId === null || draft.trim() === '' || sending) return;
    const body = draft.trim();
    setDraft('');
    setSending(true);
    const result = await sendMessage(selectedId, body);
    setSending(false);
    if (result.status !== 'ok') {
      setDraft(body);
      setStatus(failureCopy(result.status));
    }
  }

  async function handleCreateGroup(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = groupTitle.trim();
    if (title === '') return;
    const result = await createGroupConversation(title);
    if (result.status === 'ok') {
      setGroupTitle('');
      setShowGroupComposer(false);
      await refreshConversations();
      setSelectedId(result.data);
    } else {
      setStatus(failureCopy(result.status));
    }
  }

  return (
    <section className="messages-page fade-up" aria-labelledby="messages-title">
      <aside className="conversation-rail">
        <header className="conversation-rail-header">
          <div><span className="eyebrow">Your circle</span><h1 id="messages-title">Messages</h1></div>
          <button type="button" className="conversation-new" onClick={() => setShowGroupComposer((value) => !value)} aria-label="Create a group conversation" aria-expanded={showGroupComposer}><Icon name={showGroupComposer ? 'close' : 'plus'} /></button>
        </header>

        {showGroupComposer && <form className="new-group-form" onSubmit={(event) => void handleCreateGroup(event)}><label htmlFor="new-group-title">New group</label><div><input id="new-group-title" className="input" value={groupTitle} maxLength={80} autoFocus placeholder="Movie night crew" onChange={(event) => setGroupTitle(event.target.value)} /><button className="button button-primary" type="submit" disabled={groupTitle.trim() === ''}><Icon name="users" size={16} />Create</button></div><small>You can add up to 29 more accepted friends after creating it.</small></form>}

        <label className="conversation-search"><Icon name="search" size={17} /><input value={conversationQuery} placeholder="Search conversations" onChange={(event) => setConversationQuery(event.target.value)} aria-label="Search conversations" />{conversationQuery !== '' && <button type="button" onClick={() => setConversationQuery('')} aria-label="Clear conversation search"><Icon name="close" size={14} /></button>}</label>

        <div className="conversation-list">
          {loading ? <div className="conversation-loading"><span className="loader-orbit" />Loading conversations…</div> : visibleConversations.length === 0 ? <p className="social-empty">{conversationQuery === '' ? 'Start a conversation from your Friends page.' : 'No conversations match that search.'}</p> : visibleConversations.map((conversation) => (
            <button key={conversation.id} type="button" className={`conversation-item${selectedId === conversation.id ? ' conversation-item-active' : ''}`} onClick={() => setSelectedId(conversation.id)}>
              <span className="conversation-avatar"><Icon name={conversation.kind === 'group' ? 'users' : 'message'} /></span>
              <span><strong>{conversation.title ?? 'Direct message'}</strong><small>{conversation.kind === 'group' ? 'Group conversation' : 'Private conversation'}</small></span>
              {conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b>}
            </button>
          ))}
        </div>
      </aside>

      <div className="message-stage">
        {selected === null ? <div className="message-empty"><Icon name="message" size={32} /><h2>Your conversations live here</h2><p>Open an existing conversation or start one from Friends.</p></div> : <>
          <header className="message-stage-header"><div><span className="eyebrow">{selected.kind === 'group' ? 'Group conversation' : 'Direct message'}</span><h2>{selected.title ?? 'Direct message'}</h2></div><span className="message-security"><Icon name="lock" size={14} />Membership protected</span></header>
          <div className="message-log" ref={logRef}>
            {hasOlder && <button type="button" className="button message-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
            {loadingMessages && messages.length === 0 && <div className="message-empty"><span className="loader-orbit" /><p>Loading messages…</p></div>}
            {!loadingMessages && messages.length === 0 && <div className="message-empty"><Icon name="sparkle" size={30} /><h2>Say hello</h2><p>This is the beginning of the conversation.</p></div>}
            {messages.map((message) => message.kind === 'system' ? <p key={message.id} className="message-system"><Icon name="info" size={14} />{message.body}</p> : <article key={message.id} className="direct-message"><span className="person-avatar" aria-hidden="true">{message.displayName.slice(0, 1).toUpperCase()}</span><div><header><strong>{message.displayName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p className={message.deletedAt !== null ? 'message-deleted' : ''}>{message.deletedAt !== null ? 'Message deleted' : message.body}</p></div></article>)}
          </div>
          <form className="message-composer" onSubmit={(event) => void handleSend(event)}><input className="input" value={draft} maxLength={2000} placeholder={`Message ${selected.title ?? 'conversation'}…`} onChange={(event) => setDraft(event.target.value)} /><span className="message-character-count">{draft.length > 1800 ? `${draft.length}/2000` : ''}</span><button type="submit" className="button button-primary" disabled={sending || draft.trim() === ''}><Icon name="send" size={17} />{sending ? 'Sending…' : 'Send'}</button></form>
        </>}
        {status !== null && <p className="social-notice message-status" role="status">{status}<button type="button" onClick={() => setStatus(null)} aria-label="Dismiss message"><Icon name="close" size={14} /></button></p>}
      </div>
    </section>
  );
}
