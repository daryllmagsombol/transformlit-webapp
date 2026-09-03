import { messageAddedFilter, MessageAddedPayload } from './message-added.filter.js';

const payload: MessageAddedPayload = {
  messageAdded: { id: 'm1', conversationId: 'c1', senderId: 'a', body: 'hi', createdAt: new Date() } as any,
  memberIds: ['a', 'b'],
};

describe('messageAddedFilter', () => {
  it('delivers to members when no conversationId is given', () => {
    expect(messageAddedFilter(payload, {}, { req: { user: { id: 'b' } } })).toBe(true);
  });

  it('drops non-members', () => {
    expect(messageAddedFilter(payload, {}, { req: { user: { id: 'c' } } })).toBe(false);
  });

  it('drops events without a resolved user', () => {
    expect(messageAddedFilter(payload, {}, {})).toBe(false);
  });

  it('delivers to members when conversationId matches', () => {
    expect(messageAddedFilter(payload, { conversationId: 'c1' }, { req: { user: { id: 'b' } } })).toBe(true);
  });

  it('drops when conversationId does not match', () => {
    expect(messageAddedFilter(payload, { conversationId: 'other' }, { req: { user: { id: 'b' } } })).toBe(false);
  });
});