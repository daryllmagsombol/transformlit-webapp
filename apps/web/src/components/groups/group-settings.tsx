'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { GraphQLGroup } from '@transformlit/shared';
import { useToast } from '../ui';
import { GROUP_CATEGORIES } from '../../lib/constants';
import { resolveImageUrl, uploadImage, updateGroup, deleteGroup } from '../../lib/groups';

const settingsSchema = z.object({
  name: z.string().min(2, 'Group name must be at least 2 characters'),
  description: z.string().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  category: z.string(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

interface GroupSettingsProps {
  group: GraphQLGroup;
  onChanged: () => void;
}

export function GroupSettings({ group, onChanged }: GroupSettingsProps) {
  const { addToast } = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coverUrl, setCoverUrl] = useState<string | undefined>(resolveImageUrl(group.coverImageUrl));
  const [coverKey, setCoverKey] = useState<string | undefined>(group.coverImageUrl ?? undefined);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: group.name,
      description: group.description ?? '',
      visibility: group.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      category: group.category ?? GROUP_CATEGORIES[0].key,
    },
  });

  const handleCoverChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const key = await uploadImage(file);
        setCoverKey(key);
        setCoverUrl(resolveImageUrl(key));
        addToast('Cover image uploaded.', 'success');
      } catch {
        addToast('Cover upload failed. Please try again.', 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [addToast],
  );

  const onSubmit = useCallback(
    async (values: SettingsFormValues) => {
      setSaving(true);
      try {
        await updateGroup(group.id, {
          name: values.name.trim(),
          description: values.description?.trim(),
          visibility: values.visibility,
          category: values.category,
          coverImageUrl: coverKey,
        });
        addToast('Group settings saved.', 'success');
        onChanged();
      } catch {
        addToast('Failed to save settings.', 'error');
      } finally {
        setSaving(false);
      }
    },
    [group.id, coverKey, onChanged, addToast],
  );

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete this group permanently? This cannot be undone.')) return;
    try {
      await deleteGroup(group.id);
      addToast('Group deleted.', 'info');
      router.push('/groups');
    } catch {
      addToast('Failed to delete group.', 'error');
    }
  }, [group.id, router, addToast]);

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4 md:p-6 space-y-5">
        <h3 className="font-display text-headline-h3 text-on-surface">General Information</h3>

        {/* Cover image */}
        <div className="space-y-2">
          <label className="font-small text-small font-semibold text-on-surface">Cover image</label>
          <div className="flex items-center gap-4">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Group cover"
                className="h-32 w-56 rounded-xl object-cover border border-outline-variant"
              />
            ) : (
              <div className="h-32 w-56 rounded-xl bg-surface-container border border-outline-variant flex items-center justify-center">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant">image</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface-container text-on-surface font-small text-small hover:bg-surface-container-high transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-sm">upload</span>
              {uploading ? 'Uploading…' : 'Upload new image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleCoverChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1">
          <label htmlFor="group-name" className="font-small text-small font-semibold text-on-surface">
            Group name
          </label>
          <input
            id="group-name"
            type="text"
            {...register('name')}
            className="w-full bg-surface-container rounded-xl px-4 py-2 font-body text-body text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container border border-outline-variant/50"
          />
          {errors.name && <p className="font-micro text-micro text-red-500">{errors.name.message}</p>}
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label htmlFor="group-description" className="font-small text-small font-semibold text-on-surface">
            Description
          </label>
          <textarea
            id="group-description"
            {...register('description')}
            rows={4}
            className="w-full bg-surface-container rounded-xl px-4 py-3 font-body text-body text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container border border-outline-variant/50 resize-none"
          />
        </div>

        {/* Category + Visibility */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="group-category" className="font-small text-small font-semibold text-on-surface">
              Category
            </label>
            <select
              id="group-category"
              {...register('category')}
              className="w-full bg-surface-container rounded-xl px-4 py-2 font-body text-body text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container border border-outline-variant/50"
            >
              {GROUP_CATEGORIES.map((cat) => (
                <option key={cat.key} value={cat.key}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="group-visibility" className="font-small text-small font-semibold text-on-surface">
              Visibility
            </label>
            <select
              id="group-visibility"
              {...register('visibility')}
              className="w-full bg-surface-container rounded-xl px-4 py-2 font-body text-body text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container border border-outline-variant/50"
            >
              <option value="PUBLIC">Public</option>
              <option value="PRIVATE">Private</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-primary-container text-on-primary-container font-small text-small font-semibold hover:bg-inverse-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* Danger zone */}
      <div className="bg-red-50 rounded-xl border border-red-200 p-4 md:p-6 space-y-3">
        <h3 className="font-display text-headline-h3 text-red-700">Delete group</h3>
        <p className="font-body text-body text-red-600/80">
          Once you delete a group, all posts, members, and data are permanently removed. This action cannot be undone.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          className="px-4 py-2 rounded-xl border border-red-500 text-red-600 font-small text-small font-semibold hover:bg-red-100 transition-colors"
        >
          Delete Group
        </button>
      </div>
    </div>
  );
}
