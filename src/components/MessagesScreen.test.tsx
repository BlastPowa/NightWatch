// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addGroupMember,
  createGroupConversation,
  getSocialGraph,
  getConversationMembers,
  getMessages,
  listConversations,
  markConversationRead,
  sendMessage,
} = vi.hoisted(() => ({
  addGroupMember: vi.fn(),
  createGroupConversation: vi.fn(),
  getSocialGraph: vi.fn(),
  getConversationMembers: vi.fn(),
  getMessages: vi.fn(),
  listConversations: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/lib/social/MessagingService', () => ({
  addGroupMember,
  createGroupConversation,
  deleteMessage: vi.fn(),
  editMessage: vi.fn(),
  getMessages,
  listConversations,
  markConversationRead,
  sendMessage,
}));

vi.mock('@/lib/social/FriendService', () => ({
  getSocialGraph,
}));

vi.mock('@/lib/social/SocialProfileService', () => ({
  getConversationMembers,
}));

vi.mock('@/lib/social/SocialRealtime', () => ({
  subscribeToConversation: vi.fn(() => () => undefined),
}));

vi.mock('@/components/GroupManagementPanel', () => ({
  GroupManagementPanel: () => <div>Group management</div>,
}));

import { MessagesScreen } from '@/components/MessagesScreen';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  listConversations.mockResolvedValue({
    status: 'ok',
    data: [{
      id: 'conversation-1',
      kind: 'direct',
      title: null,
      ownerId: 'self',
      updatedAt: '2026-07-16T10:00:00.000Z',
      unreadCount: 0,
    }],
  });
  getConversationMembers.mockResolvedValue({
    status: 'ok',
    data: [
      { userId: 'self', displayName: 'Boogie', avatarUrl: null, selectedBorderId: null, role: 'member', joinedAt: '2026-07-16T09:00:00.000Z' },
      { userId: 'friend', displayName: 'Friend', avatarUrl: null, selectedBorderId: null, role: 'member', joinedAt: '2026-07-16T09:00:00.000Z' },
    ],
  });
  getMessages
    .mockResolvedValueOnce({ status: 'ok', data: [] })
    .mockResolvedValue({
      status: 'ok',
      data: [{
        id: 'message-1',
        seq: 1,
        senderId: 'self',
        displayName: 'Boogie',
        kind: 'message',
        body: 'Movie night?',
        createdAt: '2026-07-16T10:01:00.000Z',
        editedAt: null,
        deletedAt: null,
      }],
    });
  markConversationRead.mockResolvedValue({ status: 'ok', data: undefined });
  sendMessage.mockResolvedValue({ status: 'ok', data: 'message-1' });
  createGroupConversation.mockResolvedValue({ status: 'ok', data: 'group-1' });
  addGroupMember.mockResolvedValue({ status: 'ok', data: undefined });
  getSocialGraph.mockResolvedValue({
    status: 'ok',
    data: { friends: [], incoming: [], outgoing: [], suggestions: [], blocked: [] },
  });
});

describe('MessagesScreen', () => {
  it('refreshes the conversation after a successful send without waiting for Realtime', async () => {
    const user = userEvent.setup();
    render(<MessagesScreen initialConversationId="conversation-1" currentUserId="self" />);

    const composer = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(composer, 'Movie night?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('conversation-1', 'Movie night?'));
    expect(await screen.findByText('Movie night?')).toBeTruthy();
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it('renders the group composer as a named input and dedicated create action', async () => {
    const user = userEvent.setup();
    render(<MessagesScreen initialConversationId="conversation-1" currentUserId="self" />);

    await user.click(await screen.findByRole('button', { name: 'Create a group conversation' }));

    expect(screen.getByRole('textbox', { name: 'New group' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(screen.getByText(/Up to 30 people total/)).toBeTruthy();
  });
});
