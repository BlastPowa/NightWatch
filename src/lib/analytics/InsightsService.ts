import { supabase } from '@/lib/supabase';

/** Owner-only reads of session analytics (RLS enforced server-side). */

export interface SessionSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface SessionEvent {
  at: string;
  kind: 'members' | 'play' | 'pause' | 'seek' | 'reaction';
  value: number;
}

export async function listSessions(roomCode: string): Promise<SessionSummary[]> {
  const { data, error } = await supabase
    .from('room_sessions')
    .select('id, started_at, ended_at')
    .eq('room_code', roomCode)
    .order('started_at', { ascending: false })
    .limit(20);
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data.map((row) => ({
    id: row.id as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
  }));
}

export async function listSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const { data, error } = await supabase
    .from('session_events')
    .select('at, kind, value')
    .eq('session_id', sessionId)
    .order('at', { ascending: true })
    .limit(2000);
  if (error !== null || !Array.isArray(data)) {
    return [];
  }
  return data as SessionEvent[];
}
