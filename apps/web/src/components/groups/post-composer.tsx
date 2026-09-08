'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { uploadImage, createGroupPost, resolveImageUrl } from '../../lib/groups';
import { useToast } from '../ui';

interface PostComposerProps {
  readonly groupId: string;
  readonly onPosted: () => void;
}

export function PostComposer({ groupId, onPosted }: PostComposerProps) {
  const { addToast } = useToast();
  const [body, setBody] = useState('');
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const key = await uploadImage(file);
        setImageKey(key);
      } catch {
        addToast('Image upload failed. Please try again.', 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [addToast],
  );

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = body.trim();
      if (!trimmed && !imageKey) return;
      setSubmitting(true);
      try {
        await createGroupPost(groupId, trimmed, imageKey ?? undefined);
        setBody('');
        setImageKey(null);
        onPosted();
      } catch {
        addToast('Failed to post. Please try again.', 'error');
      } finally {
        setSubmitting(false);
      }
    },
    [body, imageKey, groupId, onPosted, addToast],
  );

  const canSubmit = (body.trim() || imageKey) && !submitting && !uploading;

  return (
    <form onSubmit={handleSubmit} className="bg-paper-warm rounded-xl shadow-sm border border-outline-variant p-4 space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's on your mind?"
        className="w-full bg-surface-container rounded-xl p-3 font-body text-body text-on-surface placeholder:text-on-surface-variant/60 resize-none min-h-[88px] focus:outline-none focus:ring-2 focus:ring-primary-container"
      />

      {imageKey && (
        <div className="relative inline-block">
          <img
            src={resolveImageUrl(imageKey)}
            alt="Upload preview"
            className="h-24 w-auto rounded-xl object-cover border border-outline-variant"
          />
          <button
            type="button"
            onClick={() => setImageKey(null)}
            className="absolute -top-2 -right-2 w-6 h-6 bg-surface rounded-full border border-outline-variant flex items-center justify-center text-on-surface-variant hover:text-on-surface"
            aria-label="Remove image"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors font-small text-small disabled:opacity-60"
        >
          <span className="material-symbols-outlined">image</span>
          {uploading ? 'Uploading…' : 'Photo'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-container text-on-primary-container font-small text-small font-semibold hover:bg-inverse-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Post
        </button>
      </div>
    </form>
  );
}
