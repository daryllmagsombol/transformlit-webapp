'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GraphQLBook, GraphQLGroupReadingPlan } from '@transformlit/shared';
import { useToast, LoadingSpinner } from '../ui';
import {
  fetchGroupReadingPlan,
  fetchBooksForPlan,
  CREATE_GROUP_READING_PLAN_MUTATION,
  ARCHIVE_GROUP_READING_PLAN_MUTATION,
} from '../../lib/group-features';
import { apolloClient } from '../../lib/apollo-client';

interface GroupReadingPlanProps {
  readonly groupId: string;
  readonly canModerate: boolean;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One member's pacing row. */
function MemberRow({ member }: { readonly member: GraphQLGroupReadingPlan['members'][number] }) {
  const initial = member.user.displayName?.[0]?.toUpperCase() ?? '?';
  return (
    <li className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface px-3 py-2">
      {member.user.avatarUrl ? (
        <img src={member.user.avatarUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full object-cover" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-container text-on-primary-container font-micro font-semibold">
          {initial}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-small text-small text-on-surface">
        {member.user.displayName}
      </span>
      <span className="font-micro text-micro text-on-surface-variant">
        {member.currentPage}
        {member.totalPages ? ` / ${member.totalPages}` : ''} · {member.percent}%
      </span>
      <span
        className={`rounded-full px-2 py-0.5 font-micro uppercase ${
          member.onPace
            ? 'bg-primary-container text-on-primary-container'
            : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        {member.onPace ? 'On pace' : 'Behind'}
      </span>
    </li>
  );
}

/** Moderator-only form to start a plan. */
function StartPlanForm({
  groupId,
  onCreated,
}: {
  readonly groupId: string;
  readonly onCreated: () => void;
}) {
  const { addToast } = useToast();
  const [books, setBooks] = useState<GraphQLBook[]>([]);
  const [bookId, setBookId] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(toDateInput(new Date()));
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBooksForPlan().then(setBooks).catch(() => setBooks([]));
  }, []);

  const submit = useCallback(
    async (event: React.SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!bookId) {
        setError('Pick a book.');
        return;
      }
      if (!targetDate || targetDate <= startDate) {
        setError('Target date must be after the start date.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await apolloClient.mutate({
          mutation: CREATE_GROUP_READING_PLAN_MUTATION,
          variables: {
            input: {
              groupId,
              bookId,
              title: title.trim() || null,
              startDate,
              targetDate,
            },
          },
        });
        addToast('Reading plan started.', 'success');
        onCreated();
      } catch {
        addToast('Failed to start the plan.', 'error');
      } finally {
        setSaving(false);
      }
    },
    [bookId, title, startDate, targetDate, groupId, addToast, onCreated],
  );

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3"
    >
      <h3 className="font-display text-headline-h4 text-on-surface">Start a reading plan</h3>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-book" className="font-small text-small font-semibold text-on-surface">
          Book
        </label>
        <select
          id="plan-book"
          value={bookId}
          onChange={(event) => setBookId(event.target.value)}
          className="rounded-lg border border-outline-variant bg-surface px-3 py-2 font-body text-small text-on-surface"
        >
          <option value="">Select a book…</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="plan-title" className="font-small text-small font-semibold text-on-surface">
          Title (optional)
        </label>
        <input
          id="plan-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className="rounded-lg border border-outline-variant bg-surface px-3 py-2 font-body text-small text-on-surface"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-start" className="font-small text-small font-semibold text-on-surface">
            Start
          </label>
          <input
            id="plan-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 font-body text-small text-on-surface"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="plan-target" className="font-small text-small font-semibold text-on-surface">
            Target
          </label>
          <input
            id="plan-target"
            type="date"
            value={targetDate}
            onChange={(event) => setTargetDate(event.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2 font-body text-small text-on-surface"
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="font-small text-small text-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-primary px-4 py-2 font-small text-small font-semibold text-on-primary disabled:opacity-60"
      >
        {saving ? 'Starting…' : 'Start plan'}
      </button>
    </form>
  );
}

export function GroupReadingPlan({ groupId, canModerate }: GroupReadingPlanProps) {
  const { addToast } = useToast();
  const [plan, setPlan] = useState<GraphQLGroupReadingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setPlan(await fetchGroupReadingPlan(groupId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const archive = useCallback(async () => {
    if (!plan) return;
    setArchiving(true);
    try {
      await apolloClient.mutate({
        mutation: ARCHIVE_GROUP_READING_PLAN_MUTATION,
        variables: { planId: plan.id },
      });
      await load();
    } catch {
      addToast('Failed to archive the plan.', 'error');
    } finally {
      setArchiving(false);
    }
  }, [plan, load, addToast]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-8 text-center">
        <p className="font-body text-body text-on-surface-variant">
          The reading plan is unavailable right now.
        </p>
      </div>
    );
  }

  if (!plan) {
    if (canModerate) return <StartPlanForm groupId={groupId} onCreated={load} />;
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2" aria-hidden="true">
          auto_stories
        </span>
        <p className="font-body text-body text-on-surface-variant">No reading plan yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
        {plan.book.coverUrl ? (
          <img src={plan.book.coverUrl} alt="" width={72} height={104} className="h-[104px] w-[72px] rounded object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-headline-h4 text-on-surface">
            {plan.title || plan.book.title}
          </h3>
          {plan.book.author ? (
            <p className="font-small text-small text-on-surface-variant">{plan.book.author}</p>
          ) : null}
          <p className="mt-1 font-micro text-micro uppercase tracking-wider text-on-surface-variant">
            {formatDate(plan.startDate)} – {formatDate(plan.targetDate)}
          </p>
          <div className="mt-3">
            <div className="mb-1 flex justify-between font-micro text-micro text-on-surface-variant">
              <span>Expected pace</span>
              <span>{plan.expectedPercent}%</span>
            </div>
            <progress
              className="h-2 w-full overflow-hidden rounded-full"
              aria-label="Expected reading pace"
              value={plan.expectedPercent}
              max={100}
            />
          </div>
        </div>
      </div>

      <div>
        <h4 className="mb-2 font-micro text-micro uppercase tracking-wider text-on-surface-variant">
          Members
        </h4>
        {plan.members.length === 0 ? (
          <p className="font-small text-small text-on-surface-variant">No active members yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="plan-members">
            {plan.members.map((member) => (
              <MemberRow key={member.user.id} member={member} />
            ))}
          </ul>
        )}
      </div>

      {canModerate ? (
        <button
          type="button"
          onClick={archive}
          disabled={archiving}
          className="rounded-lg border border-outline-variant px-4 py-2 font-small text-small font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
        >
          {archiving ? 'Archiving…' : 'Archive plan'}
        </button>
      ) : null}
    </div>
  );
}
