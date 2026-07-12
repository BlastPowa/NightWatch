import { useEffect, useState, type FormEvent } from 'react';
import { createGroupConversation, getMessages, listConversations, markConversationRead, sendMessage, type Conversation, type Message } from '@/lib/social/MessagingService';
import { subscribeToConversation } from '@/lib/social/SocialRealtime';

interface MessagesScreenProps { initialConversationId: string | null; }

export function MessagesScreen({ initialConversationId }: MessagesScreenProps): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshConversations(): Promise<void> {
    const result = await listConversations();
    setLoading(false);
    if (result.status === 'ok') {
      setConversations(result.data);
      setSelectedId((current) => current ?? result.data[0]?.id ?? null);
    } else setStatus('Conversations could not be loaded.');
  }

  async function refreshMessages(id: string): Promise<void> {
    const result = await getMessages(id);
    if (result.status !== 'ok') { setStatus('Messages could not be loaded.'); return; }
    const ordered = [...result.data].sort((a, b) => a.seq - b.seq);
    setMessages(ordered);
    const latest = ordered.at(-1);
    if (latest !== undefined) void markConversationRead(id, latest.id).then(() => void refreshConversations());
  }

  useEffect(() => { void refreshConversations(); }, []);
  useEffect(() => {
    if (selectedId === null) { setMessages([]); return; }
    void refreshMessages(selectedId);
    return subscribeToConversation(selectedId, (change) => {
      setMessages((current) => {
        const without = current.filter((item) => item.id !== change.message.id);
        return [...without, change.message].sort((a, b) => a.seq - b.seq);
      });
      void markConversationRead(selectedId, change.message.id);
    });
  }, [selectedId]);

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (selectedId === null || draft.trim() === '') return;
    const body = draft.trim(); setDraft('');
    const result = await sendMessage(selectedId, body);
    if (result.status !== 'ok') { setDraft(body); setStatus(result.status === 'rate-limited' ? 'Slow down before sending another message.' : 'Message could not be sent.'); }
  }

  async function handleCreateGroup(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = groupTitle.trim(); if (title === '') return;
    const result = await createGroupConversation(title);
    if (result.status === 'ok') { setGroupTitle(''); await refreshConversations(); setSelectedId(result.data); }
    else setStatus('Group could not be created.');
  }

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  return <section className="messages-page fade-up" aria-labelledby="messages-title">
    <aside className="conversation-rail">
      <header><span className="eyebrow">Your circle</span><h1 id="messages-title">Messages</h1></header>
      <form className="new-group-form" onSubmit={(event) => void handleCreateGroup(event)}><input className="input" value={groupTitle} maxLength={80} placeholder="New group name" onChange={(event) => setGroupTitle(event.target.value)} /><button className="button" type="submit">Create</button></form>
      <div className="conversation-list">{loading ? <p>Loading…</p> : conversations.length === 0 ? <p className="social-empty">Start a conversation from your Friends page.</p> : conversations.map((conversation) => <button key={conversation.id} type="button" className={`conversation-item${selectedId === conversation.id ? ' conversation-item-active' : ''}`} onClick={() => setSelectedId(conversation.id)}><span className="conversation-avatar" aria-hidden="true">{conversation.kind === 'group' ? '◇' : '●'}</span><span><strong>{conversation.title ?? 'Direct message'}</strong><small>{conversation.kind === 'group' ? 'Group conversation' : 'Private conversation'}</small></span>{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</button>)}</div>
    </aside>
    <div className="message-stage">
      {selected === null ? <div className="message-empty"><span aria-hidden="true">✦</span><h2>Your conversations live here</h2><p>Open an existing conversation or start one from Friends.</p></div> : <><header className="message-stage-header"><div><span className="eyebrow">{selected.kind}</span><h2>{selected.title ?? 'Direct message'}</h2></div></header><div className="message-log">{messages.length === 0 && <div className="message-empty"><span aria-hidden="true">✦</span><h2>Say hello</h2><p>This is the beginning of the conversation.</p></div>}{messages.map((message) => message.kind === 'system' ? <p key={message.id} className="message-system">{message.body}</p> : <article key={message.id} className="direct-message"><span className="person-avatar" aria-hidden="true">{message.displayName.slice(0,1).toUpperCase()}</span><div><header><strong>{message.displayName}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p className={message.deletedAt !== null ? 'message-deleted' : ''}>{message.deletedAt !== null ? 'Message deleted' : message.body}</p></div></article>)}</div><form className="message-composer" onSubmit={(event) => void handleSend(event)}><input className="input" value={draft} maxLength={2000} placeholder={`Message ${selected.title ?? 'conversation'}…`} onChange={(event) => setDraft(event.target.value)} /><button type="submit" className="button button-primary">Send</button></form></>}
      {status !== null && <p className="social-notice" role="status">{status}</p>}
    </div>
  </section>;
}
