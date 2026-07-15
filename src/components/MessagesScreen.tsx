import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createGroupConversation,
  deleteMessage,
  editMessage,
  getMessages,
  listConversations,
  markConversationRead,
  sendMessage,
  type Conversation,
  type Message,
} from '@/lib/social/MessagingService';
import { subscribeToConversation } from '@/lib/social/SocialRealtime';
import { Icon } from '@/components/Icon';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { prepareOutgoingMessage } from '@/lib/chat/messageFilter';
import { GroupManagementPanel } from '@/components/GroupManagementPanel';
import {
  getConversationMembers,
  type ConversationMember as AuthorizedConversationMember,
} from '@/lib/social/SocialProfileService';
import '@/styles/phase26-social.css';

interface MessagesScreenProps {
  initialConversationId: string | null;
  currentUserId: string;
}

function failureCopy(status: string): string {
  if (status === 'rate-limited') return 'Slow down before sending another message.';
  if (status === 'blocked') return 'This conversation is unavailable because someone is blocked.';
  if (status === 'forbidden') return 'You no longer have access to this conversation.';
  if (status === 'offline') return 'Messages are offline. Check your connection and retry.';
  return 'Messages could not complete that action.';
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MessagesScreen({ initialConversationId, currentUserId }: MessagesScreenProps): JSX.Element {
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const [showGroupManagement, setShowGroupManagement] = useState(false);
  const [rosters, setRosters] = useState<Map<string, AuthorizedConversationMember[]>>(new Map());
  const logRef = useRef<HTMLDivElement | null>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const selectedRoster = selectedId === null ? [] : rosters.get(selectedId) ?? [];

  function displayTitle(conversation: Conversation): string {
    if (conversation.title !== null && conversation.title.trim() !== '') return conversation.title;
    const other = (rosters.get(conversation.id) ?? []).find((member) => member.userId !== currentUserId);
    return other?.displayName ?? 'Direct message';
  }

  const visibleConversations = useMemo(() => {
    const query = conversationQuery.trim().toLocaleLowerCase();
    if (query === '') return conversations;
    return conversations.filter((item) => {
      const title = item.title ?? rosters.get(item.id)?.find((member) => member.userId !== currentUserId)?.displayName ?? 'Direct message';
      return title.toLocaleLowerCase().includes(query);
    });
  }, [conversationQuery, conversations, currentUserId, rosters]);

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
    let active = true;
    if (conversations.length === 0) {
      setRosters(new Map());
      return () => { active = false; };
    }
    void Promise.all(conversations.map(async (conversation) => {
      const result = await getConversationMembers(conversation.id);
      return [conversation.id, result.status === 'ok' ? result.data : []] as const;
    })).then((rows) => {
      if (active) setRosters(new Map(rows));
    });
    return () => { active = false; };
  }, [conversations]);
  useEffect(() => {
    if (selectedId === null) {
      setMessages([]);
      return;
    }
    setDraft('');
    setEditingMessageId(null);
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
    const body = prepareOutgoingMessage(draft, 2_000);
    setSending(true);
    const result = editingMessageId === null
      ? await sendMessage(selectedId, body)
      : await editMessage(editingMessageId, body);
    setSending(false);
    if (result.status !== 'ok') {
      setStatus(failureCopy(result.status));
      return;
    }
    if (editingMessageId !== null) {
      const editedId = editingMessageId;
      setMessages((current) => current.map((message) => message.id === editedId
        ? { ...message, body, editedAt: new Date().toISOString() }
        : message));
      setEditingMessageId(null);
    }
    setDraft('');
  }

  function beginEdit(message: Message): void {
    setEditingMessageId(message.id);
    setDraft(message.body);
    setStatus(null);
  }

  async function removeMessage(message: Message): Promise<void> {
    if (!window.confirm('Delete this message? It will remain as a tombstone in the conversation.')) return;
    const result = await deleteMessage(message.id);
    if (result.status !== 'ok') {
      setStatus(failureCopy(result.status));
      return;
    }
    setMessages((current) => current.map((item) => item.id === message.id
      ? { ...item, body: '', deletedAt: new Date().toISOString() }
      : item));
    if (editingMessageId === message.id) {
      setEditingMessageId(null);
      setDraft('');
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

        {showGroupComposer && <form className="new-group-form" onSubmit={(event) => void handleCreateGroup(event)}><label htmlFor="new-group-title">New group</label><div><input id="new-group-title" className="input" value={groupTitle} maxLength={60} autoFocus placeholder="Movie night crew" onChange={(event) => setGroupTitle(event.target.value)} /><button className="button button-primary" type="submit" disabled={groupTitle.trim() === ''}><Icon name="users" size={16} />Create</button></div><small>You can add up to 29 more accepted friends after creating it.</small></form>}

        <label className="conversation-search"><Icon name="search" size={17} /><input value={conversationQuery} placeholder="Search conversations" onChange={(event) => setConversationQuery(event.target.value)} aria-label="Search conversations" />{conversationQuery !== '' && <button type="button" onClick={() => setConversationQuery('')} aria-label="Clear conversation search"><Icon name="close" size={14} /></button>}</label>

        <div className="conversation-list">
          {loading ? <div className="conversation-loading"><span className="loader-orbit" />Loading conversations…</div> : visibleConversations.length === 0 ? <p className="social-empty">{conversationQuery === '' ? 'Start a conversation from your Friends page.' : 'No conversations match that search.'}</p> : visibleConversations.map((conversation) => {
            const title = displayTitle(conversation);
            const other = rosters.get(conversation.id)?.find((member) => member.userId !== currentUserId);
            return (
              <button key={conversation.id} type="button" className={`conversation-item${selectedId === conversation.id ? ' conversation-item-active' : ''}${conversation.unreadCount > 0 ? ' conversation-item-unread' : ''}`} onClick={() => setSelectedId(conversation.id)} aria-current={selectedId === conversation.id ? 'page' : undefined}>
                <span className="conversation-avatar">
                  {conversation.kind === 'group' ? <Icon name="users" /> : <ProfileAvatar name={title} src={other?.avatarUrl ?? null} className={other?.selectedBorderId !== null && other?.selectedBorderId !== undefined ? `conversation-avatar-image border-${other.selectedBorderId}` : 'conversation-avatar-image'} />}
                </span>
                <span><strong>{title}</strong><small>{conversation.kind === 'group' ? `${rosters.get(conversation.id)?.length ?? 0} members` : formatConversationTime(conversation.updatedAt)}</small></span>
                {conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b>}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="message-stage">
        {selected === null ? <div className="message-empty"><Icon name="message" size={32} /><h2>Your conversations live here</h2><p>Open an existing conversation or start one from Friends.</p></div> : <>
          <header className="message-stage-header"><div className="message-stage-identity"><span className="eyebrow">{selected.kind === 'group' ? 'Group conversation' : 'Direct message'}</span><h2>{displayTitle(selected)}</h2><small>{selected.kind === 'group' ? `${selectedRoster.length} authorized members` : 'Private conversation'}</small></div><div className="message-stage-actions"><span className="message-security"><Icon name="lock" size={14} />Membership protected</span>{selected.kind === 'group' && <button type="button" className="button" onClick={() => setShowGroupManagement(true)}><Icon name="users" size={16} />Members</button>}</div></header>
          <div className="message-log" ref={logRef}>
            {hasOlder && <button type="button" className="button message-load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
            {loadingMessages && messages.length === 0 && <div className="message-empty"><span className="loader-orbit" /><p>Loading messages…</p></div>}
            {!loadingMessages && messages.length === 0 && <div className="message-empty"><Icon name="sparkle" size={30} /><h2>Say hello</h2><p>This is the beginning of the conversation.</p></div>}
            {messages.map((message) => {
              if (message.kind === 'system') return <p key={message.id} className="message-system" role="note"><Icon name="info" size={14} />{message.body}</p>;
              const member = selectedRoster.find((item) => item.userId === message.senderId);
              const senderName = member?.displayName ?? message.displayName;
              const isSelf = message.senderId === currentUserId;
              return <article key={message.id} className={`direct-message${isSelf ? ' direct-message-self' : ''}`}><ProfileAvatar name={senderName} src={member?.avatarUrl ?? null} className={member?.selectedBorderId !== null && member?.selectedBorderId !== undefined ? `person-avatar border-${member.selectedBorderId}` : 'person-avatar'} /><div><header><strong>{isSelf ? 'You' : senderName}</strong><span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{message.editedAt !== null && message.deletedAt === null && <small>edited</small>}</span></header><p className={message.deletedAt !== null ? 'message-deleted' : ''}>{message.deletedAt !== null ? 'Message deleted' : message.body}</p>{isSelf && message.deletedAt === null && <div className="direct-message-actions"><button type="button" onClick={() => beginEdit(message)}>Edit</button><button type="button" onClick={() => void removeMessage(message)}>Delete</button></div>}</div></article>;
            })}
          </div>
          {editingMessageId !== null && <div className="message-edit-notice"><span><Icon name="check" size={15} />Editing message</span><button type="button" onClick={() => { setEditingMessageId(null); setDraft(''); }}>Cancel</button></div>}
          <form className="message-composer" onSubmit={(event) => void handleSend(event)}><input className="input" value={draft} maxLength={2000} placeholder={editingMessageId === null ? `Message ${displayTitle(selected)}…` : 'Update your message…'} aria-label={editingMessageId === null ? 'Message' : 'Edit message'} onChange={(event) => setDraft(event.target.value)} /><span className="message-character-count">{draft.length > 1800 ? `${draft.length}/2000` : ''}</span><button type="submit" className="button button-primary" disabled={sending || draft.trim() === ''}><Icon name={editingMessageId === null ? 'send' : 'check'} size={17} />{sending ? 'Saving…' : editingMessageId === null ? 'Send' : 'Save'}</button></form>
        </>}
        {status !== null && <p className="social-notice message-status message-status-error" role="alert"><Icon name="info" size={15} />{status}<button type="button" onClick={() => setStatus(null)} aria-label="Dismiss message"><Icon name="close" size={14} /></button></p>}
        {selected !== null && selected.kind === 'group' && showGroupManagement && <div className="group-management-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowGroupManagement(false); }}><GroupManagementPanel conversation={selected} currentUserId={currentUserId} onClose={() => setShowGroupManagement(false)} onChanged={refreshConversations} onLeft={() => { setSelectedId(null); setShowGroupManagement(false); void refreshConversations(); }} /></div>}
      </div>
    </section>
  );
}
