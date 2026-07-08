import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomMember } from '@shared/room';
import { useChat } from '@/hooks/useChat';
import type { RoomService } from '@/lib/room/RoomService';

interface ChatPanelProps {
  service: RoomService;
  members: readonly RoomMember[];
  selfName: string;
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatPanel({ service, members, selfName }: ChatPanelProps): JSX.Element {
  const { entries, send } = useChat(service, members);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  function handleScroll(): void {
    const log = logRef.current;
    if (log !== null) {
      stickToBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    }
  }

  useEffect(() => {
    const log = logRef.current;
    if (log !== null && stickToBottomRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [entries]);

  function handleSend(event: FormEvent): void {
    event.preventDefault();
    if (send(draft, selfName) === 'ok') {
      setDraft('');
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-log" ref={logRef} onScroll={handleScroll}>
        {entries.length === 0 && <p className="chat-empty">Say hi 👋</p>}
        {entries.map((entry) =>
          entry.kind === 'system' ? (
            <p key={entry.id} className="chat-system">
              {entry.text}
            </p>
          ) : (
            <p key={entry.id} className="chat-message">
              <span className="chat-meta">
                <span className={entry.senderId === service.selfId ? 'chat-sender chat-sender-self' : 'chat-sender'}>
                  {entry.senderName}
                </span>
                <span className="chat-time">{formatTime(entry.at)}</span>
              </span>
              {entry.text}
            </p>
          ),
        )}
      </div>

      <form className="chat-form" onSubmit={handleSend}>
        <input
          className="input"
          value={draft}
          maxLength={500}
          placeholder="Message…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="button">
          Send
        </button>
      </form>
    </div>
  );
}
