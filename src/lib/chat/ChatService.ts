import {
  RegExpMatcher,
  TextCensor,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';
import type { RoomMember } from '@shared/room';
import type { RoomService } from '@/lib/room/RoomService';
import { settingsStore } from '@/lib/settings';

/**
 * Profanity filtering happens once, at the source (§7.7): outgoing text is
 * censored before broadcast so every recipient sees the same result.
 */
const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
const profanityCensor = new TextCensor();

function censorProfanity(text: string): string {
  return profanityCensor.applyTo(text, profanityMatcher.getAllMatches(text));
}

export interface ChatEntry {
  id: string;
  kind: 'message' | 'system';
  senderId: string | null;
  senderName: string | null;
  text: string;
  at: number;
}

export type SendResult = 'ok' | 'empty' | 'rate-limited';

export type ChatChangeListener = (entries: readonly ChatEntry[]) => void;

const MAX_MESSAGE_LENGTH = 500;
const MAX_LOG_ENTRIES = 200;
const MIN_SEND_INTERVAL_MS = 500;

/**
 * Ephemeral room chat (zero-DB, ADR-004): messages live in memory for the
 * duration of the session only. Also derives system notices (join/leave/
 * host change) from presence member-list diffs.
 */
export class ChatService {
  private entries: ChatEntry[] = [];
  private lastSentAt = 0;
  private unsubscribe: (() => void) | null = null;
  private knownMembers: Map<string, { name: string; isHost: boolean }> | null = null;

  public constructor(
    private readonly room: RoomService,
    private readonly onChange: ChatChangeListener,
  ) {}

  public start(): void {
    this.unsubscribe = this.room.on('chat:message', (envelope) => {
      // Bound incoming fields — other clients are untrusted (§8).
      const text = typeof envelope.data.text === 'string' ? envelope.data.text : '';
      const senderName =
        typeof envelope.data.senderName === 'string' ? envelope.data.senderName : 'Unknown';
      if (text.length === 0) {
        return;
      }
      this.push({
        id: crypto.randomUUID(),
        kind: 'message',
        senderId: envelope.senderId,
        senderName: senderName.slice(0, 24),
        text: text.slice(0, MAX_MESSAGE_LENGTH),
        at: envelope.sentAt,
      });
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Send a message. Own messages are appended locally (broadcast self=false). */
  public send(text: string, senderName: string): SendResult {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    const clean = settingsStore.get().chatFilterEnabled ? censorProfanity(trimmed) : trimmed;
    if (clean.length === 0) {
      return 'empty';
    }
    const now = Date.now();
    if (now - this.lastSentAt < MIN_SEND_INTERVAL_MS) {
      return 'rate-limited';
    }
    this.lastSentAt = now;

    this.push({
      id: crypto.randomUUID(),
      kind: 'message',
      senderId: this.room.selfId,
      senderName,
      text: clean,
      at: now,
    });
    this.room.send('chat:message', { text: clean, senderName }).catch(() => {
      this.pushSystem('Message could not be delivered.');
    });
    return 'ok';
  }

  /** Feed presence member lists here; diffs become system notices. */
  public handleMembers(members: readonly RoomMember[]): void {
    const next = new Map(members.map((m) => [m.id, { name: m.displayName, isHost: m.isHost }]));

    // First roster after joining: don't announce everyone already present.
    if (this.knownMembers === null) {
      if (members.length > 0) {
        this.knownMembers = next;
      }
      return;
    }

    for (const [id, info] of next) {
      const previous = this.knownMembers.get(id);
      if (previous === undefined) {
        if (id !== this.room.selfId) {
          this.pushSystem(`${info.name} joined.`);
        }
      } else if (!previous.isHost && info.isHost) {
        this.pushSystem(`${info.name} is now the host.`);
      }
    }

    for (const [id, info] of this.knownMembers) {
      if (!next.has(id) && id !== this.room.selfId) {
        this.pushSystem(`${info.name} left.`);
      }
    }

    this.knownMembers = next;
  }

  private pushSystem(text: string): void {
    this.push({
      id: crypto.randomUUID(),
      kind: 'system',
      senderId: null,
      senderName: null,
      text,
      at: Date.now(),
    });
  }

  private push(entry: ChatEntry): void {
    this.entries = [...this.entries, entry].slice(-MAX_LOG_ENTRIES);
    this.onChange(this.entries);
  }
}
