'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MyActivityCalendarDocument,
  MyProgressDocument,
  SetReadingGoalDocument,
  type GoalKind,
  type MyActivityCalendarQuery,
  type MyProgressQuery,
} from '@transformlit/graphql';
import type { ActivityType } from '@transformlit/shared';
import { apolloClient } from '../../../lib/apollo-client';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useToast, LoadingSpinner } from '../../../components/ui';
import { recordActivity } from '../../../lib/progress/record-activity';

type ProgressData = MyProgressQuery['myProgress'];
type CalendarPoint = MyActivityCalendarQuery['myActivityCalendar'][number];

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Shading ramp for activity counts 0–4. Kept outside render for a stable map. */
const INTENSITY_CLASSES: Record<number, string> = {
  0: 'bg-surface-container-high',
  1: 'bg-primary-fixed-dim/45',
  2: 'bg-primary-fixed-dim',
  3: 'bg-brand-orange-dark',
  4: 'bg-primary',
};

function clampIntensity(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(4, Math.trunc(count));
}

function intensityClass(count: number): string {
  return INTENSITY_CLASSES[clampIntensity(count)];
}

/* ── Date helpers (UTC-only; no timezone drift) ─────────────────────────── */

function parseDayKey(dayKey: string): { year: number; month: number; day: number } | null {
  const [year, month, day] = dayKey.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

/** Weekday of Jan 1 for a year, 0 = Sunday. */
function firstWeekdayOfYear(year: number): number {
  return new Date(Date.UTC(year, 0, 1)).getUTCDay();
}

/**
 * Maps a `dayKey` to its position in a 7-row calendar grid where each column
 * is a calendar week (Sunday-first). Returns 1-based grid coordinates so the
 * cell can be placed explicitly — sparse activity still lines up with the
 * real weekday it happened on.
 */
function calendarPosition(dayKey: string, year: number): { column: number; row: number } {
  const parsed = parseDayKey(dayKey);
  if (parsed?.year !== year) return { column: 1, row: 1 };
  const startOfYear = Date.UTC(year, 0, 1);
  const current = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const dayOfYear = Math.round((current - startOfYear) / 86_400_000);
  const ordinal = dayOfYear + firstWeekdayOfYear(year);
  return { column: Math.floor(ordinal / 7) + 1, row: (ordinal % 7) + 1 };
}

/** One label per month, placed at the week column its 1st day lands in. */
function monthLabelColumns(year: number): Array<{ label: string; column: number }> {
  const firstWeekday = firstWeekdayOfYear(year);
  return MONTHS.map((label, index) => {
    const dayOfYear = Math.round(
      (Date.UTC(year, index, 1) - Date.UTC(year, 0, 1)) / 86_400_000,
    );
    return { label, column: Math.floor((dayOfYear + firstWeekday) / 7) + 1 };
  });
}

/** Humanizes a `YYYY-MM-DD` key without constructing a timezone-sensitive Date. */
function formatDayKey(dayKey: string | null): string {
  if (!dayKey) return 'No activity yet';
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey;
  const monthLabel = MONTHS[parsed.month - 1] ?? '';
  if (!monthLabel) return dayKey;
  return `${monthLabel} ${parsed.day}, ${parsed.year}`;
}

function goalProgressLabel(kind: GoalKind): string {
  return kind === 'DAYS' ? 'days read' : 'pages read';
}

/** The rolled-up value the goal measures against, per its target kind. */
function goalMetricValue(progress: ProgressData): number {
  if (!progress.goal) return 0;
  return progress.goal.targetKind === 'DAYS' ? progress.daysRead : progress.pagesRead;
}

/** Goal completion as a rounded 0–100 percentage, clamped. */
function goalPercent(progress: ProgressData): number {
  if (!progress.goal || progress.goal.targetValue <= 0) return 0;
  const ratio = goalMetricValue(progress) / progress.goal.targetValue;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

interface GoalValidationError {
  readonly message: string;
}

/** Returns a validation error for a DAYS/PAGES target, or null when valid. */
function validateGoal(kind: GoalKind, rawValue: number): GoalValidationError | null {
  if (!Number.isInteger(rawValue) || rawValue < 1) {
    return { message: 'Enter a whole number of at least 1.' };
  }
  if (kind === 'DAYS' && rawValue > 366) {
    return { message: 'A DAYS goal cannot exceed 366.' };
  }
  if (kind === 'PAGES' && rawValue > 100000) {
    return { message: 'A PAGES goal cannot exceed 100,000.' };
  }
  return null;
}

/* ── Streak header ───────────────────────────────────────────────────────── */

interface StreakHeaderProps {
  readonly progress: ProgressData | null;
  readonly loading: boolean;
  readonly failed: boolean;
}

function StreakStat({
  testId,
  icon,
  label,
  value,
  dayKey,
}: {
  readonly testId: string;
  readonly icon: string;
  readonly label: string;
  readonly value: string;
  readonly dayKey?: string;
}) {
  return (
    <div
      className="flex-1 min-w-[140px] rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
      data-day-key={dayKey}
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-on-surface-variant mb-1">
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
        <span className="font-micro text-micro uppercase tracking-widest">{label}</span>
      </div>
      <p className="font-headline-h2 text-headline-h2 text-on-surface">{value}</p>
    </div>
  );
}

function StreakHeader({ progress, loading, failed }: StreakHeaderProps) {
  if (failed) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-error/40 bg-error-container/40 p-4 font-small text-small text-on-error-container"
      >
        Couldn&apos;t load your progress right now. Your calendar below may still be available.
      </div>
    );
  }

  if (loading || !progress) {
    return (
      <div className="flex flex-wrap gap-4" aria-hidden="true">
        {['current', 'longest', 'last'].map((key) => (
          <div
            key={key}
            className="flex-1 min-w-[140px] h-[92px] rounded-xl bg-surface-container-high animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-4">
      <StreakStat
        testId="current-streak"
        icon="local_fire_department"
        label="Current streak"
        value={`${progress.currentStreak} ${progress.currentStreak === 1 ? 'day' : 'days'}`}
      />
      <StreakStat
        testId="longest-streak"
        icon="emoji_events"
        label="Longest streak"
        value={`${progress.longestStreak} ${progress.longestStreak === 1 ? 'day' : 'days'}`}
      />
      <StreakStat
        testId="last-active"
        icon="event_available"
        label="Last active"
        value={formatDayKey(progress.lastActiveDayKey)}
        dayKey={progress.lastActiveDayKey ?? undefined}
      />
    </div>
  );
}

/* ── Heatmap calendar ────────────────────────────────────────────────────── */

interface HeatmapProps {
  readonly points: readonly CalendarPoint[];
  readonly year: number;
  readonly loading: boolean;
  readonly failed: boolean;
}

function heatmapBody(points: readonly CalendarPoint[], year: number, loading: boolean, failed: boolean) {
  if (loading) {
    return (
      <div className="flex gap-1" aria-hidden="true">
        {['a', 'b', 'c', 'd', 'e', 'f'].map((col) => (
          <div key={col} className="flex flex-col gap-1">
            {['1', '2', '3', '4', '5', '6', '7'].map((row) => (
              <div key={`${col}-${row}`} className="w-3.5 h-3.5 rounded-sm bg-surface-container-high animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <p className="font-small text-small text-on-surface-variant">
        Couldn&apos;t load your activity calendar. Try again later.
      </p>
    );
  }
  if (points.length === 0) {
    return (
      <p className="font-small text-small text-on-surface-variant">
        No reading recorded in {year} yet. Start reading to light up your calendar.
      </p>
    );
  }
  return (
    <>
      <div
        className="grid grid-flow-col gap-1 mb-1 select-none"
        style={{ gridAutoColumns: '0.875rem' }}
        aria-hidden="true"
      >
        {monthLabelColumns(year).map(({ label, column }) => (
          <span
            key={label}
            style={{ gridColumn: column }}
            className="font-micro text-micro text-on-surface-variant"
          >
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid grid-rows-7 grid-flow-col gap-1"
        style={{ gridAutoColumns: '0.875rem' }}
      >
        {points.map((point) => {
          const { column, row } = calendarPosition(point.dayKey, year);
          return (
            <div
              key={point.dayKey}
              data-testid="heatmap-cell"
              data-day-key={point.dayKey}
              data-intensity={clampIntensity(point.activityCount)}
              title={`${formatDayKey(point.dayKey)} — ${point.activityCount} of 4 activity types`}
              style={{ gridColumn: column, gridRow: row }}
              className={`w-3.5 h-3.5 rounded-sm border border-outline-variant/30 ${intensityClass(point.activityCount)}`}
            />
          );
        })}
      </div>
    </>
  );
}

function HeatmapLegend() {
  return (
    <div className="flex items-center gap-2 font-micro text-micro text-on-surface-variant">
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <span
          key={level}
          className={`w-3.5 h-3.5 rounded-sm border border-outline-variant/30 ${INTENSITY_CLASSES[level]}`}
        />
      ))}
      <span>More</span>
    </div>
  );
}

function Heatmap({ points, year, loading, failed }: HeatmapProps) {
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-headline-h3 text-on-surface">Activity calendar</h2>
        <HeatmapLegend />
      </div>
      <div className="overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
        {heatmapBody(points, year, loading, failed)}
      </div>
    </section>
  );
}

/* ── Goal editor ─────────────────────────────────────────────────────────── */

interface GoalEditorProps {
  readonly year: number;
  readonly goal: ProgressData['goal'];
  readonly onSaved: (saved: { targetKind: GoalKind; targetValue: number }) => void;
}

function GoalEditor({ year, goal, onSaved }: GoalEditorProps) {
  const { addToast } = useToast();
  const [kind, setKind] = useState<GoalKind>(goal?.targetKind ?? 'DAYS');
  const [value, setValue] = useState<string>(goal ? String(goal.targetValue) : '');
  const [error, setError] = useState<GoalValidationError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Re-sync the form whenever the selected year's goal changes (including to
    // null when switching to a year that has no goal yet).
    setKind(goal?.targetKind ?? 'DAYS');
    setValue(goal ? String(goal.targetValue) : '');
    setError(null);
  }, [goal]);

  const handleSubmit = useCallback(
    async (event: React.SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsed = Number.parseInt(value, 10);
      const validation = validateGoal(kind, parsed);
      if (validation) {
        setError(validation);
        return;
      }
      setError(null);
      setSaving(true);
      try {
        await apolloClient.mutate({
          mutation: SetReadingGoalDocument,
          variables: { input: { year, targetKind: kind, targetValue: parsed } },
        });
        addToast('Goal saved.', 'success');
        onSaved({ targetKind: kind, targetValue: parsed });
      } catch {
        setError({ message: 'Could not save your goal. Please try again.' });
        addToast('Could not save your goal.', 'error');
      } finally {
        setSaving(false);
      }
    },
    [addToast, kind, onSaved, value, year],
  );

  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 md:p-6">
      <h2 className="font-display text-headline-h3 text-on-surface mb-1">Yearly goal</h2>
      <p className="font-small text-small text-on-surface-variant mb-4">
        Pick a target for {year}. You can change it any time.
      </p>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <fieldset>
          <legend className="font-micro text-micro uppercase tracking-widest text-on-surface-variant mb-2">
            Goal type
          </legend>
          <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
            {(['DAYS', 'PAGES'] as const).map((option) => {
              const active = kind === option;
              const optionClass = active
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high';
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setKind(option);
                    setError(null);
                  }}
                  className={`px-4 py-2 font-small text-small font-semibold transition-colors ${optionClass}`}
                >
                  {option === 'DAYS' ? 'Days' : 'Pages'}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <label
            htmlFor="goal-target"
            className="block font-sans text-sm font-semibold text-on-surface ml-1"
          >
            Goal target
          </label>
          <input
            id="goal-target"
            name="goalTarget"
            type="number"
            inputMode="numeric"
            min={1}
            max={kind === 'DAYS' ? 366 : 100000}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder={kind === 'DAYS' ? 'e.g. 200' : 'e.g. 5000'}
            aria-invalid={error !== null}
            aria-describedby={error ? 'goal-target-error' : 'goal-target-hint'}
            className={`w-full h-11 rounded-lg border bg-surface-container-lowest px-4 text-base outline-none transition-all ${
              error
                ? 'border-error focus:ring-2 focus:ring-error/20'
                : 'border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20'
            }`}
          />
          {error ? (
            <p id="goal-target-error" role="alert" className="text-xs text-error ml-1">
              {error.message}
            </p>
          ) : (
            <p id="goal-target-hint" className="text-xs text-on-surface-variant italic ml-1">
              {kind === 'DAYS'
                ? 'Days read this year (1–366).'
                : `Pages read this year (1–100,000).`}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="self-start inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-display text-small font-bold text-on-primary transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">flag</span>
          {saving ? 'Saving…' : 'Save goal'}
        </button>
      </form>
    </section>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ProgressClient() {
  const { isReady } = useRequireAuth();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [year, setYear] = useState(currentYear);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [points, setPoints] = useState<CalendarPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [progressFailed, setProgressFailed] = useState(false);
  const [calendarFailed, setCalendarFailed] = useState(false);

  const loadData = useCallback(async (targetYear: number) => {
    setLoading(true);
    setProgressFailed(false);
    setCalendarFailed(false);

    const [progressResult, calendarResult] = await Promise.allSettled([
      apolloClient.query({ query: MyProgressDocument, variables: { year: targetYear }, fetchPolicy: 'network-only' }),
      apolloClient.query({ query: MyActivityCalendarDocument, variables: { year: targetYear }, fetchPolicy: 'network-only' }),
    ]);

    if (progressResult.status === 'fulfilled') {
      setProgress(progressResult.value.data?.myProgress ?? null);
    } else {
      setProgressFailed(true);
    }

    if (calendarResult.status === 'fulfilled') {
      setPoints(calendarResult.value.data?.myActivityCalendar ?? []);
    } else {
      setCalendarFailed(true);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (isReady) {
      loadData(year);
    }
  }, [isReady, year, loadData]);

  const handleSaved = useCallback(
    (saved: { targetKind: GoalKind; targetValue: number }) => {
      setProgress((prev) =>
        prev
          ? { ...prev, goal: { year: prev.year, targetKind: saved.targetKind, targetValue: saved.targetValue } }
          : prev,
      );
      loadData(year);
    },
    [loadData, year],
  );

  const handleCheckIn = useCallback(() => {
    // Type-only import of the shared enum keeps this module parseable under the
    // web jest config (the shared package's ESM `dist` is not transformed).
    // Await the write before re-querying so the refreshed streak/calendar
    // includes today rather than racing the mutation.
    void recordActivity({ type: 'BOOK_READ' as ActivityType, pagesDelta: 1 }).then(() =>
      loadData(year),
    );
  }, [loadData, year]);

  if (!isReady) {
    return <LoadingSpinner />;
  }

  const goal = progress?.goal ?? null;
  const goalLabel = goal ? goalProgressLabel(goal.targetKind) : null;
  const metricValue = progress ? goalMetricValue(progress) : 0;
  const percent = progress ? goalPercent(progress) : 0;
  const goalUnit = goal?.targetKind === 'DAYS' ? 'day' : 'page';

  return (
    <div className="flex flex-col gap-6 py-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-micro text-micro uppercase tracking-[0.2em] text-brand-orange-dark mb-1">
            Reading progress
          </p>
          <h1 className="font-display text-display-mobile md:text-display text-on-surface leading-tight">
            Keep the streak alive
          </h1>
          <p className="font-body text-body text-on-surface-variant max-w-xl mt-1">
            {goal
              ? `You've read ${metricValue} ${goalLabel} — ${percent}% of your ${goal.targetValue}-${goalUnit} goal in ${year}.`
              : `Set a yearly goal for ${year} and watch your reading days stack up.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous year"
            onClick={() => setYear((prev) => prev - 1)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container-high"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <span className="font-display text-headline-h3 text-on-surface tabular-nums min-w-[4ch] text-center">
            {year}
          </span>
          <button
            type="button"
            aria-label="Next year"
            disabled={year >= currentYear}
            onClick={() => setYear((prev) => Math.min(currentYear, prev + 1))}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
      </header>

      <StreakHeader progress={progress} loading={loading} failed={progressFailed} />

      <Heatmap points={points} year={year} loading={loading} failed={calendarFailed} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GoalEditor year={year} goal={goal} onSaved={handleSaved} />

        <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 md:p-6 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-headline-h3 text-on-surface mb-1">Did you read today?</h2>
            <p className="font-small text-small text-on-surface-variant">
              Log a reading session to keep your streak going.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckIn}
            className="self-start inline-flex items-center gap-2 rounded-lg border-2 border-primary px-6 py-3 font-display text-small font-bold text-primary transition-colors hover:bg-primary hover:text-on-primary"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              local_fire_department
            </span>
            <span>Log today&apos;s reading</span>
          </button>
        </section>
      </div>
    </div>
  );
}
