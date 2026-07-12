# Push Runbook — Phase 20C + 20D

## State as of now

- `origin/main` already contains **all of Phase 20B** (migrations `0006`–`0010`, social services, realtime). It is merged.
- `backend/phase-20c-creator` holds **Phase 20C and Phase 20D** — one branch, one PR.
- Local `main` is 13 commits behind `origin/main`. Harmless, but sync it so you are not reviewing a stale tree.
- Working tree is clean. Typecheck and the full build (renderer + Electron + Discord Activity) pass.

## Database work outstanding

`0011` and `0012` are **applied** and the 20C test passed. **`0013` is not yet applied.** Run it, then its test:

```
supabase/migrations/0013_notification_emitters.sql
supabase/tests/phase20d_notifications_test.sql
```

Expect `ALL PHASE 20D TESTS PASSED`. The test rolls back, so it is safe against the live project. See `PHASE_20D_BACKEND_STATUS.md`.

## The push

```bash
# 1. Push the branch (GitHub auth will prompt on first push)
git push -u origin backend/phase-20c-creator

# 2. Sync your local main so it is not 13 behind
git checkout main
git pull

# 3. Back to the branch
git checkout backend/phase-20c-creator
```

Then open the PR against `main` from the GitHub UI — GitHub will offer a "Compare & pull request" button for the branch.

Suggested PR title:

```
Phase 20C/20D — creator clubs, bounties, moderation, and notifications
```

Suggested PR body:

```
20C: clubs (owner/moderator/member), bounties as an audited status machine,
submissions, voting, a moderation queue, and an append-only audit log.
capabilities.creatorClubs now probes list_my_clubs.

20D: the notification emitters 20C left out. The notifications table had
readers but no writer, so the bell was permanently empty. Emitters are AFTER
triggers on the status columns rather than edits to the 20C RPCs, so no path
can skip them. Block-aware; verdicts stay private to the submitter; a reporter
is never told which moderator handled their report.

Database: 0011 and 0012 are applied and phase20c_rls_test.sql passes. 0013
still needs to be applied, with phase20d_notifications_test.sql after it.

Scope boundary per the handoff: no payments, cash rewards, YouTube account
scopes, downloads, subscriptions, or channel administration. Enforced
structurally — there is no amount/currency/payout column in the schema, and
the test asserts none exists.

See PHASE_20C_BACKEND_STATUS.md and PHASE_20D_BACKEND_STATUS.md.
```

## One thing to verify before you merge

`0010_social_realtime.sql` is merged **in code**, but I never confirmed it was **applied to the database**. If it was not, every realtime subscription connects and then silently receives nothing — no error anywhere, which is the worst failure mode. Check in the SQL Editor:

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('messages', 'friend_requests');
```

Two rows = applied. Fewer = run `supabase/migrations/0010_social_realtime.sql`.

## After the merge

Phase 20 (B, C, D) is done on the backend. What remains, in the order I would take it:

1. **System messages.** `messages.kind = 'system'` exists but nothing writes join/leave/rename notices.
2. **Club discovery.** Create/join-by-id/list-mine only; no public directory. Deliberately deferred, since a directory needs its own moderation story.
3. **Notification digest/expiry.** Fine at current scale; revisit if a club ever gets large.

The frontend lane has `frontend/phase-20b-profile-social` in flight against this backend. `PHASE_20B_BACKEND_STATUS.md` and `PHASE_20C_BACKEND_STATUS.md` on `main` are the contracts they build against.
