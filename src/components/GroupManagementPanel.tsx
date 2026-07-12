import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { getSocialGraph } from '@/lib/social/FriendService';
import {
  addGroupMember,
  leaveConversation,
  listConversationMembers,
  removeGroupMember,
  renameGroup,
  setConversationRole,
  transferOwnership,
  type Conversation,
  type ConversationMember,
  type MemberRole,
} from '@/lib/social/MessagingService';
import type { SocialResult } from '@/lib/social/types';

export const GROUP_MEMBER_LIMIT = 30;

export interface AcceptedFriend {
  userId: string;
  displayName: string;
}

export interface GroupManagementPanelProps {
  conversation: Conversation;
  currentUserId: string;
  /** Pass an already-loaded accepted-friends list to avoid another graph read. */
  acceptedFriends?: AcceptedFriend[];
  onClose: () => void;
  /** Refresh the parent conversation list after membership or ownership changes. */
  onChanged?: () => void | Promise<void>;
  /** Lets the parent clear selection after the viewer leaves this group. */
  onLeft?: (conversationId: string) => void;
}

function failureCopy(status: string): string {
  if (status === 'forbidden') return 'You are not allowed to make that change.';
  if (status === 'blocked') return 'That person cannot be added because one of you has blocked the other.';
  if (status === 'offline') return 'Group controls are offline. Check your connection and retry.';
  if (status === 'not-ready') return 'Group controls are not available on this server yet.';
  if (status === 'unauthenticated') return 'Sign in again to manage this group.';
  return 'The group could not complete that action.';
}

function roleLabel(role: MemberRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'moderator') return 'Moderator';
  return 'Member';
}

export function GroupManagementPanel({
  conversation,
  currentUserId,
  acceptedFriends,
  onClose,
  onChanged,
  onLeft,
}: GroupManagementPanelProps): JSX.Element {
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [friends, setFriends] = useState<AcceptedFriend[]>(acceptedFriends ?? []);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [groupTitle, setGroupTitle] = useState(conversation.title ?? '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const names = useMemo(
    () => new Map(friends.map((friend) => [friend.userId, friend.displayName])),
    [friends],
  );
  const currentRole = members.find((member) => member.userId === currentUserId)?.role ??
    (conversation.ownerId === currentUserId ? 'owner' : 'member');
  const canManageMembers = currentRole === 'owner' || currentRole === 'moderator';
  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const addableFriends = friends.filter((friend) => !memberIds.has(friend.userId));

  async function refreshMembers(): Promise<boolean> {
    const result = await listConversationMembers(conversation.id);
    setLoading(false);
    if (result.status !== 'ok') {
      setNotice(failureCopy(result.status));
      return false;
    }
    setMembers(result.data);
    setNotice(null);
    return true;
  }

  useEffect(() => {
    setGroupTitle(conversation.title ?? '');
  }, [conversation.id, conversation.title]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listConversationMembers(conversation.id).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.status === 'ok') {
        setMembers(result.data);
        setNotice(null);
      } else {
        setNotice(failureCopy(result.status));
      }
    });
    return () => { active = false; };
  }, [conversation.id]);

  useEffect(() => {
    if (acceptedFriends !== undefined) {
      setFriends(acceptedFriends);
      return;
    }
    let active = true;
    void getSocialGraph().then((result) => {
      if (!active) return;
      if (result.status === 'ok') {
        setFriends(result.data.friends.map(({ userId, displayName }) => ({ userId, displayName })));
      } else {
        setNotice(failureCopy(result.status));
      }
    });
    return () => { active = false; };
  }, [acceptedFriends]);

  async function finishAction(result: SocialResult<void>, success: string): Promise<boolean> {
    if (result.status !== 'ok') {
      setNotice(failureCopy(result.status));
      return false;
    }
    await refreshMembers();
    await onChanged?.();
    setNotice(success);
    return true;
  }

  async function run(action: () => Promise<SocialResult<void>>, success: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    const completed = await finishAction(await action(), success);
    setBusy(false);
    return completed;
  }

  async function addMember(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (selectedFriendId === '' || members.length >= GROUP_MEMBER_LIMIT) return;
    const added = await run(
      () => addGroupMember(conversation.id, selectedFriendId),
      'Friend added to the group.',
    );
    if (added) setSelectedFriendId('');
  }

  async function rename(event: FormEvent): Promise<void> {
    event.preventDefault();
    const title = groupTitle.trim();
    if (title.length === 0 || title === conversation.title) return;
    await run(() => renameGroup(conversation.id, title), 'Group renamed.');
  }

  async function removeMember(member: ConversationMember): Promise<void> {
    const displayName = names.get(member.userId) ?? 'this member';
    if (!window.confirm(`Remove ${displayName} from the group?`)) return;
    await run(() => removeGroupMember(conversation.id, member.userId), 'Member removed.');
  }

  async function changeRole(member: ConversationMember): Promise<void> {
    const nextRole = member.role === 'moderator' ? 'member' : 'moderator';
    await run(
      () => setConversationRole(conversation.id, member.userId, nextRole),
      nextRole === 'moderator' ? 'Member promoted to moderator.' : 'Moderator demoted to member.',
    );
  }

  async function transfer(member: ConversationMember): Promise<void> {
    const displayName = names.get(member.userId) ?? 'this member';
    if (!window.confirm(`Transfer ownership to ${displayName}? You will become a member.`)) return;
    await run(
      () => transferOwnership(conversation.id, member.userId),
      'Ownership transferred.',
    );
  }

  async function leave(): Promise<void> {
    if (!window.confirm(`Leave ${conversation.title ?? 'this group'}?`)) return;
    const left = await run(() => leaveConversation(conversation.id), 'You left the group.');
    if (left) {
      onLeft?.(conversation.id);
      onClose();
    }
  }

  return (
    <aside className="group-management-panel" role="dialog" aria-modal="true" aria-labelledby="group-management-title">
      <header className="group-management-header">
        <div>
          <span className="eyebrow">Group controls</span>
          <h2 id="group-management-title">{conversation.title ?? 'Group members'}</h2>
        </div>
        <button type="button" className="conversation-new" onClick={onClose} aria-label="Close group controls">
          <Icon name="close" />
        </button>
      </header>

      <div className="group-management-summary">
        <strong>{members.length}/{GROUP_MEMBER_LIMIT} members</strong>
        <small>Your role: {roleLabel(currentRole)}</small>
      </div>

      {canManageMembers && (
        <form className="group-rename-form" onSubmit={(event) => void rename(event)}>
          <label htmlFor={`group-title-${conversation.id}`}>Group name</label>
          <div>
            <input id={`group-title-${conversation.id}`} className="input" value={groupTitle} minLength={1} maxLength={60} onChange={(event) => setGroupTitle(event.target.value)} />
            <button type="submit" className="button" disabled={busy || groupTitle.trim() === '' || groupTitle.trim() === conversation.title}>Rename</button>
          </div>
        </form>
      )}

      {canManageMembers && (
        <form className="group-add-member" onSubmit={(event) => void addMember(event)}>
          <label htmlFor={`group-friend-${conversation.id}`}>Add an accepted friend</label>
          <div>
            <select
              id={`group-friend-${conversation.id}`}
              className="input"
              value={selectedFriendId}
              disabled={busy || members.length >= GROUP_MEMBER_LIMIT || addableFriends.length === 0}
              onChange={(event) => setSelectedFriendId(event.target.value)}
            >
              <option value="">{members.length >= GROUP_MEMBER_LIMIT ? 'Group is full' : 'Choose a friend'}</option>
              {addableFriends.map((friend) => <option key={friend.userId} value={friend.userId}>{friend.displayName}</option>)}
            </select>
            <button type="submit" className="button button-primary" disabled={busy || selectedFriendId === '' || members.length >= GROUP_MEMBER_LIMIT}>
              <Icon name="plus" size={15} />Add
            </button>
          </div>
        </form>
      )}

      <div className="group-member-list" aria-live="polite">
        {loading && <div className="conversation-loading"><span className="loader-orbit" />Loading members…</div>}
        {!loading && members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const displayName = isSelf ? 'You' : names.get(member.userId) ?? `Group member · ${member.userId.slice(0, 8)}`;
          const canRemove = canManageMembers && !isSelf && member.role !== 'owner';
          return (
            <article className="group-member-row" key={member.userId}>
              <span className="person-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
              <div className="group-member-copy">
                <strong>{displayName}</strong>
                <small>{roleLabel(member.role)}</small>
              </div>
              <div className="group-member-actions">
                {currentRole === 'owner' && !isSelf && member.role !== 'owner' && (
                  <button type="button" className="button" disabled={busy} onClick={() => void changeRole(member)}>
                    {member.role === 'moderator' ? 'Demote' : 'Promote'}
                  </button>
                )}
                {currentRole === 'owner' && !isSelf && (
                  <button type="button" className="button" disabled={busy} onClick={() => void transfer(member)}>Make owner</button>
                )}
                {canRemove && (
                  <button type="button" className="button" disabled={busy} onClick={() => void removeMember(member)}>Remove</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {currentRole === 'owner' ? (
        <p className="social-empty">Transfer ownership before leaving this group.</p>
      ) : (
        <button type="button" className="button group-leave-button" disabled={busy} onClick={() => void leave()}>Leave group</button>
      )}
      {notice !== null && <p className="social-notice" role="status">{notice}</p>}
    </aside>
  );
}
