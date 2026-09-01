'use client';

import type { GraphQLGroup } from '@transformlit/shared';

interface GroupSettingsProps {
  group: GraphQLGroup;
  onChanged: () => void;
}

export function GroupSettings({ group }: GroupSettingsProps) {
  return (
    <div className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-8 text-center">
      <p className="font-body text-body text-on-surface-variant">Settings coming soon. {group.name}</p>
    </div>
  );
}
