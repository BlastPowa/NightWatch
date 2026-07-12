import { useEffect, useRef, useState } from 'react';
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/social/CreatorService';
import { subscribeToNotifications } from '@/lib/social/SocialRealtime';

function payloadText(notification: AppNotification): string {
  const safe = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = notification.payload[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.slice(0, 100);
    }
    return null;
  };
  const club = safe('club_name', 'clubName');
  const bounty = safe('bounty_title', 'bountyTitle');
  switch (notification.kind) {
    case 'bounty.open': return bounty === null ? 'A bounty is now open.' : `“${bounty}” is now open.`;
    case 'bounty.judging': return bounty === null ? 'A bounty entered judging.' : `“${bounty}” entered judging.`;
    case 'bounty.closed': return bounty === null ? 'A bounty has closed.' : `“${bounty}” has closed.`;
    case 'bounty.cancelled': return bounty === null ? 'A bounty was cancelled.' : `“${bounty}” was cancelled.`;
    case 'submission.accepted': return 'Your creator submission was accepted.';
    case 'submission.rejected': return 'Your creator submission was reviewed.';
    case 'club.role': return club === null ? 'Your club role changed.' : `Your role changed in ${club}.`;
    case 'report.resolved': return 'A report you submitted was resolved.';
    default: return 'There is an update from your NightWatch community.';
  }
}

export function NotificationCenter(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    const [list, count] = await Promise.all([listNotifications(30), countUnreadNotifications()]);
    if (list.status === 'ok') setItems(list.data);
    else setError('Notifications are temporarily unavailable.');
    if (count.status === 'ok') setUnread(count.data);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    return subscribeToNotifications(() => { void refresh(); });
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function markOne(notification: AppNotification): Promise<void> {
    if (notification.readAt !== null) return;
    setItems((current) => current.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
    setUnread((current) => Math.max(0, current - 1));
    const result = await markNotificationRead(notification.id);
    if (result.status !== 'ok') void refresh();
  }

  async function markAll(): Promise<void> {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
    setUnread(0);
    const result = await markAllNotificationsRead();
    if (result.status !== 'ok') void refresh();
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button type="button" className="topbar-icon notification-trigger" onClick={() => setOpen((value) => !value)} aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <span aria-hidden="true">♢</span>{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
      </button>
      {open && <section className="notification-popover" aria-label="Notifications">
        <header><div><span className="eyebrow">Community pulse</span><h2>Notifications</h2></div>{unread > 0 && <button type="button" onClick={() => void markAll()}>Mark all read</button>}</header>
        {error !== null && <p className="form-error">{error}</p>}
        {loading && items.length === 0 ? <div className="notification-loading"><span className="loader-orbit" />Loading updates…</div> : <div className="notification-list">{items.map((item) => <button key={item.id} type="button" className={`notification-item${item.readAt === null ? ' notification-item-unread' : ''}`} onClick={() => void markOne(item)}><span className="notification-glyph" aria-hidden="true">{item.kind.startsWith('bounty.') ? '◎' : item.kind.startsWith('submission.') ? '▶' : item.kind.startsWith('club.') ? '◇' : '✦'}</span><span><strong>{payloadText(item)}</strong><small>{new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></span>{item.readAt === null && <i aria-label="Unread" />}</button>)}</div>}
        {!loading && items.length === 0 && <div className="notification-empty"><span>✦</span><strong>You’re all caught up</strong><small>Club and bounty updates will appear here.</small></div>}
      </section>}
    </div>
  );
}
