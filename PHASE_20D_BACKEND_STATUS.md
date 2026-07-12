# Phase 20D — Notification Emitters (for the frontend lane)

Branch: `backend/phase-20c-creator` (stacked on the 20C commits — one branch, one PR).

Backend lane: **code complete. `0013_notification_emitters.sql` has NOT been applied yet** — see "To run" below. Until it is applied, `count_unread_notifications` returns `not-ready` and the bell should stay hidden.

---

## What this closes

20C shipped the `notifications` table, its RLS, and the read/mark-read RPCs — but **nothing ever wrote a row**. The bell was permanently empty. 20D adds the writers.

| Event | Kind | Who hears it |
| --- | --- | --- |
| Bounty goes `open` | `bounty.open` | Every club member except the staffer who opened it |
| Bounty goes `judging` / `closed` / `cancelled` | `bounty.judging` etc. | Everyone with a live entry (withdrawn entrants excluded) |
| Submission accepted / rejected | `submission.accepted` / `.rejected` | The submitter only — a verdict is **not** broadcast to the club |
| Club role changed | `club.role` | The person whose role changed |
| Report resolved | `report.resolved` | The reporter |

`bounty.open` is the **only** club-wide fan-out. Everything else goes to people with something at stake, which is what keeps the bell from becoming noise people learn to ignore.

---

## Client surface

```ts
import {
  listNotifications, countUnreadNotifications,
  markNotificationRead, markAllNotificationsRead,
  type NotificationKind,
} from '@/lib/social/CreatorService';
import { subscribeToNotifications } from '@/lib/social/SocialRealtime';

const stop = subscribeToNotifications(() => {
  // Something arrived. Re-read the list and the count — do not act on a raw row.
});
```

Same `SocialResult<T>` union as 20B/20C. `NotificationKind` is exported for exhaustive rendering, but **`AppNotification.kind` is deliberately a plain `string`**: an older client meeting a newer server must render an unknown kind blandly rather than crash. Always keep a default branch.

`payload` is `jsonb` and its shape varies by kind (`clubId`, `bountyId`, `title`, `status`, `submissionId`, `role`, `targetKind`…). Treat every field as optional.

---

## Three things worth knowing

1. **Blocks sever notifications.** A block means no contact, and a notification is contact — so a blocked recipient is skipped. One blocked member does not suppress the fan-out for anyone else.

2. **The reporter is never told who resolved their report.** `report.resolved` carries the outcome and nothing about the moderator. Naming the moderator to the reporter is how moderators get harassed. Do not add it.

3. **Realtime is INSERT-only.** Mark-read is an UPDATE the client itself just made; replaying it would only fight the optimistic state you already applied. Update the badge locally on mark-read, and let realtime handle arrivals.

---

## Why triggers, not RPC edits

The emitters are `AFTER UPDATE` triggers on `creator_bounties`, `bounty_submissions`, `creator_club_members`, and `creator_reports` — not edits to the 20C RPC bodies. Duplicating six already-tested function bodies to sprinkle in a `perform` call leaves two copies to drift, and a trigger on the column fires **however** the row changed, so a future RPC or an admin console cannot silently skip the notification.

The trigger functions are `security definer` on purpose. `notifications` has SELECT and UPDATE policies and deliberately **no INSERT policy** — a client cannot forge a notification. A non-definer trigger would hit that same wall. Definer is what lets the server, and only the server, write. The test asserts the missing INSERT policy so nobody "helpfully" adds one.

---

## To run

Apply in the Supabase SQL Editor:

```
supabase/migrations/0013_notification_emitters.sql
```

Then the acceptance test (creates throwaway users, asserts, **rolls back** — safe against the live project):

```
supabase/tests/phase20d_notifications_test.sql
```

Expect `ALL PHASE 20D TESTS PASSED`. It covers: fan-out on open, no self-notify, idempotent re-set not double-sending, blocks severing delivery in both the fan-out and the verdict path, withdrawn entrants excluded from judging, verdicts staying private to the submitter, role changes, anonymous report resolution, unread counting, mark-all-read not leaking across users, and the absent INSERT policy.

`0013` also adds `notifications` to the realtime publication with `replica identity full`.

---

## Honest caveats

- **The SQL has not been executed yet.** It is reviewed and the client typechecks and builds, but `0013` is machine-unverified until you run it.
- **No friend-request notification.** Friend requests already have their own realtime subscription from 20B; adding a second channel for the same event would double-render it. If you want them in the bell instead, say so — it is a small addition to `send_friend_request`.
- **No digest, batching, or expiry.** A very active club will produce one row per member per bounty open. Fine at current scale; if a club ever gets large, this is the first thing to revisit.
- **Still no club discovery.** Unchanged from 20C.
