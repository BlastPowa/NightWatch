import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactionEmoji, ReactionStamp } from '@shared/reactions';
import { achievementTracker } from '@/lib/engagement/AchievementTracker';
import { ReactionService, type ReactionContext, type ReactionSendResult } from '@/lib/reactions/ReactionService';
import type { RoomService } from '@/lib/room/RoomService';

/** A reaction currently animating over the player. */
export interface ReactionBurst {
  id: string;
  emoji: ReactionEmoji;
  /** Randomized horizontal position, percent of player width. */
  leftPercent: number;
}

export interface ReactionsBinding {
  bursts: readonly ReactionBurst[];
  /** Stamps for the given video, for timeline markers. */
  markers: readonly ReactionStamp[];
  send(emoji: ReactionEmoji): Promise<ReactionSendResult>;
  status: string | null;
  removeBurst(id: string): void;
}

const MAX_STAMPS = 500;
const MAX_CONCURRENT_BURSTS = 30;

export function useReactions(
  service: RoomService,
  getContext: () => ReactionContext,
  currentVideoId: string | null,
): ReactionsBinding {
  const [bursts, setBursts] = useState<readonly ReactionBurst[]>([]);
  const [stamps, setStamps] = useState<readonly ReactionStamp[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const reactionsRef = useRef<ReactionService | null>(null);
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;

  useEffect(() => {
    const reactions = new ReactionService(
      service,
      () => getContextRef.current(),
      (stamp) => {
        setStamps((current) => [...current, stamp].slice(-MAX_STAMPS));
        // Cap concurrent animations: overflow is recorded but not animated.
        setBursts((current) =>
          current.length >= MAX_CONCURRENT_BURSTS
            ? current
            : [...current, { id: stamp.id, emoji: stamp.emoji, leftPercent: 10 + Math.random() * 80 }],
        );
      },
    );
    reactionsRef.current = reactions;
    reactions.start();
    return () => {
      reactionsRef.current = null;
      reactions.stop();
      setBursts([]);
      setStamps([]);
    };
  }, [service]);

  const send = useCallback(async (emoji: ReactionEmoji): Promise<ReactionSendResult> => {
    const result = await (reactionsRef.current?.send(emoji) ?? Promise.resolve('disconnected' as const));
    if (result === 'ok') {
      setStatus(null);
      achievementTracker.record('reaction-sent');
    } else {
      setStatus(result === 'no-video'
        ? 'Load a video before reacting.'
        : result === 'rate-limited'
          ? 'Reacting too quickly—try again in a moment.'
          : result === 'disconnected'
            ? 'Reconnect to the room to send reactions.'
            : 'Reaction delivery failed. Try again.');
    }
    return result;
  }, []);

  const removeBurst = useCallback((id: string): void => {
    setBursts((current) => current.filter((burst) => burst.id !== id));
  }, []);

  const markers = useMemo(
    () => stamps.filter((stamp) => stamp.videoId === currentVideoId),
    [stamps, currentVideoId],
  );

  return { bursts, markers, send, status, removeBurst };
}
