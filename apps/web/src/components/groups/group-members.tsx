'use client';

interface GroupMembersProps {
  groupId: string;
  canModerate: boolean;
  isOwner: boolean;
}

export function GroupMembers({ groupId }: GroupMembersProps) {
  return (
    <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
      <p className="font-body text-body text-on-surface-variant">Members coming soon. {groupId}</p>
    </div>
  );
}
