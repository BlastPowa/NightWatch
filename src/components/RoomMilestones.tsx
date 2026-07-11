import { useEffect, useState } from 'react';
import { getRoomStats, type RoomStats } from '@/lib/engagement/LeaderboardService';

interface RoomMilestonesProps {
  roomCode: string;
}

/** Shared room milestones line (Phase 18): "12 videos · 3h together". */
export function RoomMilestones({ roomCode }: RoomMilestonesProps): JSX.Element | null {
  const [stats, setStats] = useState<RoomStats | null>(null);

  useEffect(() => {
    let active = true;
    void getRoomStats(roomCode).then((next) => {
      if (active) {
        setStats(next);
      }
    });
    return () => {
      active = false;
    };
  }, [roomCode]);

  if (stats === null || (stats.videosPlayed === 0 && stats.totalMinutes === 0)) {
    return null;
  }

  const parts: string[] = [];
  if (stats.videosPlayed > 0) {
    parts.push(`${stats.videosPlayed} video${stats.videosPlayed === 1 ? '' : 's'}`);
  }
  if (stats.totalMinutes >= 60) {
    parts.push(`${Math.floor(stats.totalMinutes / 60)}h together`);
  } else if (stats.totalMinutes > 0) {
    parts.push(`${stats.totalMinutes}m together`);
  }

  return <span className="room-milestones">🏅 {parts.join(' · ')}</span>;
}
