import { ok, toFailure, type SocialResult } from '@/lib/social/types';
import { supabase } from '@/lib/supabase';

/**
 * Phase 20C: creator clubs and bounties.
 *
 * A bounty is a social challenge whose prize is recognition — there are no
 * payments, cash rewards, or payouts anywhere in this feature, and the schema
 * has no column that could carry one (see 0011).
 *
 * Every state change is audited server-side and every mutation goes through an
 * RPC: the tables have no UPDATE policies, so a client cannot move a bounty's
 * status or a submission's verdict by writing a row directly.
 */

export type ClubRole = 'owner' | 'moderator' | 'member';
export type BountyStatus = 'draft' | 'open' | 'judging' | 'closed' | 'cancelled';
export type SubmissionStatus = 'submitted' | 'accepted' | 'rejected' | 'withdrawn';
export type ReportTarget = 'club' | 'bounty' | 'submission' | 'user';

export interface Club {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  role: ClubRole;
  memberCount: number;
  /** 'public' means listed in the directory. Clubs start private (0015). */
  visibility: ClubVisibility;
  /** Suspended clubs leave the directory and stop accepting joins. */
  suspended: boolean;
}

export type ClubVisibility = 'private' | 'public';

export interface Bounty {
  id: string;
  title: string;
  brief: string;
  status: BountyStatus;
  closesAt: string | null;
  submissionCount: number;
}

export interface BountyResult {
  submissionId: string;
  submitterId: string;
  displayName: string;
  videoId: string;
  note: string;
  status: SubmissionStatus;
  votes: number;
  isMine: boolean;
  votedByMe: boolean;
}

export interface ClubReport {
  id: string;
  targetKind: ReportTarget;
  targetId: string;
  reason: string;
  createdAt: string;
}

export interface AuditEntry {
  actorId: string;
  displayName: string;
  action: string;
  targetKind: string;
  targetId: string;
  detail: string;
  createdAt: string;
}

/**
 * The kinds 0013 currently emits. `kind` stays a plain string on the wire so an
 * older client meeting a newer server renders an unknown kind blandly rather
 * than crashing — switch on these, but always keep a default branch.
 */
export type NotificationKind =
  | 'bounty.open'
  | 'bounty.judging'
  | 'bounty.closed'
  | 'bounty.cancelled'
  | 'submission.accepted'
  | 'submission.rejected'
  | 'club.role'
  | 'report.resolved';

export interface AppNotification {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

async function transition(fn: string, args: Record<string, unknown>): Promise<SocialResult<void>> {
  const { error } = await supabase.rpc(fn, args);
  return error === null ? ok(undefined) : toFailure(error);
}

/* ----------------------------------- Clubs ---------------------------------- */

export async function listMyClubs(): Promise<SocialResult<Club[]>> {
  const { data, error } = await supabase.rpc('list_my_clubs');
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        name: str(row['name']),
        description: str(row['description']),
        ownerId: str(row['owner_id']),
        role: (row['role'] === 'owner' || row['role'] === 'moderator'
          ? row['role']
          : 'member') as ClubRole,
        memberCount: Number(row['member_count'] ?? 0),
        visibility: row['visibility'] === 'public' ? 'public' : 'private',
        suspended: row['suspended'] === true,
      })),
  );
}

export async function createClub(
  name: string,
  description = '',
): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('create_club', {
    p_name: name,
    p_description: description,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

export function joinClub(clubId: string): Promise<SocialResult<void>> {
  return transition('join_club', { p_club: clubId });
}

/** The owner cannot leave — the club would be orphaned. */
export function leaveClub(clubId: string): Promise<SocialResult<void>> {
  return transition('leave_club', { p_club: clubId });
}

/** Owner-only. Moderators cannot mint moderators. */
export function setClubRole(
  clubId: string,
  userId: string,
  role: 'moderator' | 'member',
): Promise<SocialResult<void>> {
  return transition('set_club_role', { p_club: clubId, p_user: userId, p_role: role });
}

export function removeClubMember(clubId: string, userId: string): Promise<SocialResult<void>> {
  return transition('remove_club_member', { p_club: clubId, p_user: userId });
}

/* --------------------------------- Bounties --------------------------------- */

export async function listBounties(clubId: string): Promise<SocialResult<Bounty[]>> {
  const { data, error } = await supabase.rpc('list_bounties', { p_club: clubId });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        title: str(row['title']),
        brief: str(row['brief']),
        status: str(row['status'], 'draft') as BountyStatus,
        closesAt: typeof row['closes_at'] === 'string' ? row['closes_at'] : null,
        submissionCount: Number(row['submission_count'] ?? 0),
      })),
  );
}

export async function createBounty(
  clubId: string,
  title: string,
  brief = '',
  closesAt: string | null = null,
): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('create_bounty', {
    p_club: clubId,
    p_title: title,
    p_brief: brief,
    p_closes_at: closesAt,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

/**
 * Staff-only. The server enforces the legal transitions:
 *   draft → open → judging → closed, and cancelled from any live state.
 * Anything else is rejected, so the UI cannot skip judging.
 */
export function setBountyStatus(
  bountyId: string,
  status: BountyStatus,
): Promise<SocialResult<void>> {
  return transition('set_bounty_status', { p_bounty: bountyId, p_status: status });
}

/* ------------------------------- Submissions -------------------------------- */

/** Only while the bounty is 'open'. Re-submitting replaces your entry. */
export async function submitToBounty(
  bountyId: string,
  videoId: string,
  note = '',
): Promise<SocialResult<string>> {
  const { data, error } = await supabase.rpc('submit_to_bounty', {
    p_bounty: bountyId,
    p_video_id: videoId,
    p_note: note,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return typeof data === 'string' ? ok(data) : { status: 'error' };
}

/** 'withdrawn' by the submitter; 'accepted'/'rejected' by staff. */
export function setSubmissionStatus(
  submissionId: string,
  status: Exclude<SubmissionStatus, 'submitted'>,
): Promise<SocialResult<void>> {
  return transition('set_submission_status', {
    p_submission: submissionId,
    p_status: status,
  });
}

/* ---------------------------------- Voting ---------------------------------- */

/**
 * One vote per bounty: voting for a second entry MOVES your vote rather than
 * adding one. Only during 'judging', never for your own entry.
 */
export function castVote(submissionId: string): Promise<SocialResult<void>> {
  return transition('cast_vote', { p_submission: submissionId });
}

export function retractVote(bountyId: string): Promise<SocialResult<void>> {
  return transition('retract_vote', { p_bounty: bountyId });
}

/** Tallies only — an individual's ballot is never exposed to other members. */
export async function getBountyResults(bountyId: string): Promise<SocialResult<BountyResult[]>> {
  const { data, error } = await supabase.rpc('get_bounty_results', { p_bounty: bountyId });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['submission_id'] === 'string')
      .map((row) => ({
        submissionId: str(row['submission_id']),
        submitterId: str(row['submitter_id']),
        displayName: str(row['display_name'], 'Someone'),
        videoId: str(row['video_id']),
        note: str(row['note']),
        status: str(row['status'], 'submitted') as SubmissionStatus,
        votes: Number(row['votes'] ?? 0),
        isMine: row['is_mine'] === true,
        votedByMe: row['voted_by_me'] === true,
      })),
  );
}

/* -------------------------------- Moderation -------------------------------- */

export function reportContent(
  targetKind: ReportTarget,
  targetId: string,
  reason: string,
): Promise<SocialResult<void>> {
  return transition('report_content', {
    p_target_kind: targetKind,
    p_target_id: targetId,
    p_reason: reason,
  });
}

/** Staff-only queue. Nothing auto-actions — a human resolves these. */
export async function listClubReports(clubId: string): Promise<SocialResult<ClubReport[]>> {
  const { data, error } = await supabase.rpc('list_club_reports', { p_club: clubId });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        targetKind: str(row['target_kind'], 'submission') as ReportTarget,
        targetId: str(row['target_id']),
        reason: str(row['reason']),
        createdAt: str(row['created_at']),
      })),
  );
}

export function resolveReport(
  reportId: string,
  clubId: string,
  status: 'actioned' | 'dismissed',
): Promise<SocialResult<void>> {
  return transition('resolve_report', {
    p_report: reportId,
    p_status: status,
    p_club: clubId,
  });
}

/** Append-only: not even the club owner can rewrite this. */
export async function getClubAudit(
  clubId: string,
  limit = 100,
): Promise<SocialResult<AuditEntry[]>> {
  const { data, error } = await supabase.rpc('get_club_audit', {
    p_club: clubId,
    p_limit: limit,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data).map((row) => ({
      actorId: str(row['actor_id']),
      displayName: str(row['display_name'], 'Someone'),
      action: str(row['action']),
      targetKind: str(row['target_kind']),
      targetId: str(row['target_id']),
      detail: str(row['detail']),
      createdAt: str(row['created_at']),
    })),
  );
}

/* -------------------------------- Discovery --------------------------------- */

export interface DirectoryClub {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberCount: number;
  isMember: boolean;
}

/**
 * The public club directory (Phase 21). Clubs are PRIVATE by default and appear
 * here only once their owner opts in — an existing club never becomes
 * discoverable on its own. Suspended clubs, and clubs owned by someone a block
 * stands between, are absent.
 *
 * Pass an empty query to browse.
 */
export async function searchClubs(query = '', limit = 30): Promise<SocialResult<DirectoryClub[]>> {
  const { data, error } = await supabase.rpc('search_clubs', {
    p_query: query,
    p_limit: limit,
  });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        name: str(row['name']),
        description: str(row['description']),
        ownerId: str(row['owner_id']),
        memberCount: Number(row['member_count'] ?? 0),
        isMember: row['is_member'] === true,
      })),
  );
}

/** List or unlist a club. Owner only — not a moderator's call to make. */
export function setClubVisibility(
  clubId: string,
  visibility: 'private' | 'public',
): Promise<SocialResult<void>> {
  return transition('set_club_visibility', { p_club: clubId, p_visibility: visibility });
}

/**
 * Suspend a club: it leaves the directory AND stops accepting joins, including
 * from anyone holding an old link. Staff only, audited, and reversible.
 */
export function setClubSuspended(
  clubId: string,
  suspended: boolean,
): Promise<SocialResult<void>> {
  return transition('set_club_suspended', { p_club: clubId, p_suspended: suspended });
}

/* ------------------------------ Notifications ------------------------------- */

export async function listNotifications(limit = 50): Promise<SocialResult<AppNotification[]>> {
  const { data, error } = await supabase.rpc('list_notifications', { p_limit: limit });
  if (error !== null) {
    return toFailure(error);
  }
  return ok(
    rows(data)
      .filter((row) => typeof row['id'] === 'string')
      .map((row) => ({
        id: str(row['id']),
        kind: str(row['kind']),
        payload:
          typeof row['payload'] === 'object' && row['payload'] !== null
            ? (row['payload'] as Record<string, unknown>)
            : {},
        readAt: typeof row['read_at'] === 'string' ? row['read_at'] : null,
        createdAt: str(row['created_at']),
      })),
  );
}

export function markNotificationRead(notificationId: string): Promise<SocialResult<void>> {
  return transition('mark_notification_read', { p_notification: notificationId });
}

export function markAllNotificationsRead(): Promise<SocialResult<void>> {
  return transition('mark_all_notifications_read', {});
}

/** Remove one notification from your bell for good. */
export function dismissNotification(notificationId: string): Promise<SocialResult<void>> {
  return transition('dismiss_notification', { p_notification: notificationId });
}

/** Clear everything you have already read. Never touches unread. */
export function clearReadNotifications(): Promise<SocialResult<void>> {
  return transition('clear_read_notifications', {});
}

/** Badge count. Cheap enough to call on a realtime nudge rather than a poll. */
export async function countUnreadNotifications(): Promise<SocialResult<number>> {
  const { data, error } = await supabase.rpc('count_unread_notifications');
  if (error !== null) {
    return toFailure(error);
  }
  return ok(Number(data ?? 0));
}
