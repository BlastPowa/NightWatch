/** Connection lifecycle of a realtime channel subscription. */
export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'disconnected';

export type ConnectionStatusListener = (status: ConnectionStatus) => void;

/**
 * Channel naming scheme. All channel topics are produced here so the
 * convention lives in exactly one place.
 */
export const ChannelName = {
  /** Lightweight channel used only to verify realtime connectivity. */
  system: (): string => 'nightwatch:system',
  /** Room channels (used from Phase 3 onward). */
  room: (roomId: string): string => `nightwatch:room:${roomId}`,
} as const;
