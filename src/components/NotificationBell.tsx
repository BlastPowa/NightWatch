import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearReadNotifications,
  countUnreadNotifications,
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/social/CreatorService';
import { getSocialCapabilities } from '@/lib/social/capabilities';
import { subscribeToNotifications } from '@/lib/social/SocialRealtime';

/**
 * The notification centre (Phase 21).
 *
 * The emitters shipped in 0013 and nothing ever rendered them, so every club,
 * bounty, and moderation event has been writing into a void. This is the
 * surface that makes them exist.
 *
 * Hidden entirely when the capability is false — per the handoff, an unavailable
 * surface is hidden, never shown disabled. That covers guests (no account) and
 * any deployment where the migration is not applied.
 */

/** Human copy for each kind. */
function describe(notification: AppNotification): string {
  const payload = notification.payload;
  const title = typeof payload['title'] === 'string' ? payload['title'] : 'a bounty';
  const name = typeof payload['name'] === 'string' ? payload['name'] : 'a club';
  const role = typeof payload['role'] === 'string' ? payload['role'] : 'member';

  switch (notification.kind) {
    case 'bounty.open':
      return `New bounty: ${title}`;
    case 'bounty.judging':
      return `Judging has begun on ${title}`;
    case 'bounty.closed':
      return `${title} is closed`;
    case 'bounty.cancelled':
      return `${title} was cancelled`;
    case 'submission.accepted':
      return `Your entry to ${title} was accepted`;
    case 'submission.rejected':
      return `Your entry to ${title} was not accepted`;
    case 'club.role':
      return `You are now ${role === 'moderator' ? 'a moderator' : 'a member'} of ${name}`;
    case 'report.resolved':
      return 'A report you filed has been resolved';
    default:
      // An older client meeting a newer server must degrade, not crash. `kind`
      // is a plain string on the wire precisely so this branch can exist.
      return 'Something happened in one of your clubs';
  }
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell(): JSX.Element | null {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const refreshCount = useCallback(async (): Promise<void> => {
    const result = await countUnreadNotifications();
    if (result.status === 'ok') {
      setUnread(result.data);
    }
  }, []);

  const refreshList = useCallback(async (): Promise<void> => {
    const result = await listNotifications(30);
    if (result.status === 'ok') {
      setItems(result.data);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void getSocialCapabilities().then((caps) => {
      if (!active || !caps.notifications) {
        return;
      }
      setEnabled(true);
      void refreshCount();
    });

    // Realtime carries no payload beyond "something arrived" — re-read rather
    // than acting on a raw row, so the badge always matches the list.
    const stop = subscribeToNotifications(() => {
      void refreshCount();
      void refreshList();
    });

    return () => {
      active = false;
      stop();
    };
  }, [refreshCount, refreshList]);

  // Close on outside click and on Escape: a popover that traps the user is
  // worse than no popover.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!enabled) {
    return null;
  }

  function toggle(): void {
    setOpen((current) => {
      if (!current) {
        void refreshList();
      }
      return !current;
    });
  }

  async function openItem(notification: AppNotification): Promise<void> {
    if (notification.readAt === null) {
      await markNotificationRead(notification.id);
      setItems((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      setUnread((current) => Math.max(0, current - 1));
    }
  }

  async function dismiss(notification: AppNotification): Promise<void> {
    await dismissNotification(notification.id);
    setItems((current) => current.filter((item) => item.id !== notification.id));
    if (notification.readAt === null) {
      setUnread((current) => Math.max(0, current - 1));
    }
  }

  async function markAll(): Promise<void> {
    await markAllNotificationsRead();
    setItems((current) =>
      current.map((item) =>
        item.readAt === null ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );
    setUnread(0);
  }

  async function clearRead(): Promise<void> {
    await clearReadNotifications();
    setItems((current) => current.filter((item) => item.readAt === null));
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button
        type="button"
        className={`nav-item${open ? ' nav-item-active' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <span className="nav-icon" aria-hidden="true">◔</span>
        <span className="nav-label">Alerts</span>
        {unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <header className="notification-panel-head">
            <strong>Notifications</strong>
            <div>
              {unread > 0 && (
                <button type="button" className="link-button" onClick={() => void markAll()}>
                  Mark all read
                </button>
              )}
              {items.some((item) => item.readAt !== null) && (
                <button type="button" className="link-button" onClick={() => void clearRead()}>
                  Clear read
                </button>
              )}
            </div>
          </header>

          {items.length === 0 ? (
            <p className="notification-empty">Nothing yet.</p>
          ) : (
            <ul className="notification-list">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={item.readAt === null ? 'notification-item is-unread' : 'notification-item'}
                >
                  <button type="button" className="notification-body" onClick={() => void openItem(item)}>
                    <span>{describe(item)}</span>
                    <small>{relative(item.createdAt)}</small>
                  </button>
                  <button
                    type="button"
                    className="notification-dismiss"
                    onClick={() => void dismiss(item)}
                    aria-label="Dismiss notification"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
