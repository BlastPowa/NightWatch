import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomMember } from '@shared/room';
import { ChatService, type ChatEntry, type SendResult } from '@/lib/chat/ChatService';
import type { RoomService } from '@/lib/room/RoomService';

export interface ChatBinding {
  entries: readonly ChatEntry[];
  send(text: string, senderName: string): Promise<SendResult>;
}

/** Binds a ChatService to React state for the lifetime of the room session. */
export function useChat(service: RoomService, members: readonly RoomMember[]): ChatBinding {
  const [entries, setEntries] = useState<readonly ChatEntry[]>([]);
  const chatRef = useRef<ChatService | null>(null);

  useEffect(() => {
    const chat = new ChatService(service, setEntries);
    chatRef.current = chat;
    chat.start();
    return () => {
      chatRef.current = null;
      chat.stop();
      setEntries([]);
    };
  }, [service]);

  useEffect(() => {
    chatRef.current?.handleMembers(members);
  }, [members]);

  const send = useCallback(async (text: string, senderName: string): Promise<SendResult> => {
    return chatRef.current?.send(text, senderName) ?? 'disconnected';
  }, []);

  return { entries, send };
}
