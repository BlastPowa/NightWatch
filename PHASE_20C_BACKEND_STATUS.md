# Phase 20C — Backend Status (for the frontend lane)

Branch: `backend/phase-20c-creator`. 20B is **merged into `main`**, so this branch is now a single commit on top of it — no stacking to untangle.

Backend lane: **complete. Migrations `0011`/`0012` applied, acceptance test green** (`ALL PHASE 20C TESTS PASSED`, first run).

---

## What exists

| Migration | Contents |
| --- | --- |
| `0011_creator_clubs.sql` | Tables + RLS: `creator_clubs`, `creator_club_members`, `creator_bounties`, `bounty_submissions`, `bounty_votes`, `creator_reports`, `creator_audit_log`, `notifications`. Rate limits. |
| `0012_creator_rpcs.sql` | RPCs: clubs, bounty status machine, submissions, voting, moderation, audit, notifications. |

`src/lib/social/CreatorService.ts` — the client surface. Same `SocialResult<T>` union as 20B.
`capabilities.ts` — `creatorClubs` now probes `list_my_clubs` instead of being hard-false.

---

## Scope boundary (from the handoff)

**No payments, cash rewards, YouTube account scopes, downloads, subscriptions, or channel administration.** A bounty is a social challenge whose prize is recognition.

That boundary is **structural, not policy**: there is deliberately no amount, currency, or payout column anywhere in the schema, and the test asserts none exists. A payment feature cannot be bolted on without a migration that makes the change obvious in review.

---

## The model you build against

**A bounty is a state machine, and the server owns it:**

```
draft → open → judging → closed
  └──────┴────────┴──────→ cancelled
```

- **`draft`** — staff-only; ordinary members cannot see it.
- **`open`** — members submit. One entry per person; re-submitting **replaces** it.
- **`judging`** — entries close, voting opens. You cannot submit after seeing the field, and you cannot vote before the field is complete.
- **`closed`** — final. Cannot be reopened.

Illegal transitions are refused server-side, so the UI cannot skip judging. `setBountyStatus` is idempotent.

**Voting: one vote per bounty.** You pick a single winner. Voting for a second entry **moves** your vote rather than adding one — the table's primary key enforces this, not an RPC check, because a read-then-write check loses a concurrent double-vote race. You cannot vote for yourself, and a block severs voting in both directions.

**Ballots are secret.** `bounty_votes` is readable only by the voter. `getBountyResults()` returns tallies and whether *you* voted — never who else voted for what. Do not build a "voted by" list; there is no way to get one, by design.

**Everything is audited.** Every club/bounty/submission/vote/report action writes `creator_audit_log`. That table has a SELECT policy and **nothing else** — no update, no delete — so not even a club owner can rewrite the record of what they did. `getClubAudit()` is staff-only.

**Moderation is a queue for humans.** `reportContent()` files a report (idempotent — re-reporting a target does not stack, since a report is not a vote). `listClubReports()` / `resolveReport()` are staff-only. **Nothing auto-actions.** Somebody has to work the queue; that is a process you are signing up for, not something the code resolves.

---

## Database state

`0011` and `0012` are **applied**. The acceptance test **passes** against the live project.

It covers: role hierarchy (a moderator cannot mint moderators; the owner cannot be removed or leave), draft invisibility, every illegal bounty transition, submit/vote windows, self-voting, vote-moving, blocked-user isolation in voting and results, withdrawal, the moderation queue, audit completeness, the append-only audit policy, and the no-payment-columns scope boundary.

Re-run `supabase/tests/phase20c_rls_test.sql` after any change to the creator RPCs. It rolls back, so it is safe against the live project.

## To ship

```
git push -u origin backend/phase-20c-creator
```

Then open a PR against `main`. Nothing else to run.

---

## Honest caveats

- **Notifications are a table with no writer.** The schema, RLS, and read/mark-read RPCs exist, but nothing *emits* a notification yet (e.g. "your submission was accepted"). Wiring emitters into the bounty/submission transitions is a small follow-up — say the word.
- **Clubs have no discovery.** You can create, join by id, and list your own; there is no public club directory or invite flow. Deliberate — a directory needs its own moderation story.
- **`creator_reports.target_id` is `text`, not a typed FK**, because it points at four different tables. Nothing enforces that the target exists.
