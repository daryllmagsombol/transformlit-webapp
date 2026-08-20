'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import type { GraphQLAnnouncement, GraphQLVerseOfDay, GraphQLGroup } from '@transformlit/shared';
import { useToast, SkeletonCard, LoadingSpinner } from '../../../components/ui';
import { apolloClient } from '../../../lib/apollo-client';
import { timeAgo } from '../../../lib/time-ago';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { getCategoryConfig, getGroupMeta, QUICK_TRACK_CHAPTERS } from '../../../lib/constants';

// ── GraphQL Queries ──────────────────────────────────────────────────────────

const FEED_QUERY = gql`
  query Feed {
    announcements { id title body status category publishedAt createdAt }
    verseOfDay { date text reference version }
  }
`;

const GROUPS_QUERY = gql`
  query Groups {
    groups { id name slug description memberCount visibility createdAt }
  }
`;

// ── Feed Page ────────────────────────────────────────────────────────────────

export default function FeedClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();

  const [announcements, setAnnouncements] = useState<GraphQLAnnouncement[]>([]);
  const [verse, setVerse] = useState<GraphQLVerseOfDay | null>(null);
  const [groups, setGroups] = useState<GraphQLGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [feedResult, groupsResult] = await Promise.all([
        apolloClient.query<{ announcements: GraphQLAnnouncement[]; verseOfDay: GraphQLVerseOfDay | null }>({ query: FEED_QUERY }),
        apolloClient.query<{ groups: GraphQLGroup[] }>({ query: GROUPS_QUERY }),
      ]);
      setAnnouncements(feedResult.data!.announcements ?? []);
      setVerse(feedResult.data!.verseOfDay ?? null);
      setGroups(groupsResult.data!.groups ?? []);
    } catch {
      addToast('Failed to load feed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (isReady) loadData();
  }, [isReady, loadData]);

  if (!isReady) {
    return <LoadingSpinner />;
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          MAIN CONTENT (shell TopBar/Sidebar/BottomNav live in (app)/layout)
          ═══════════════════════════════════════════════════════════ */}
      <div className="max-w-[1200px] mx-auto px-4 md:px-5 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Feed Column (8 units) */}
          <div className="lg:col-span-8 flex flex-col gap-8">
            {verse && (
              <section className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary-container to-brand-orange-dark rounded-xl blur opacity-25 group-hover:opacity-40 transition duration-1000" />
                <div className="relative bg-paper border border-primary/20 rounded-xl overflow-hidden shadow-sm p-8 md:p-12 flex flex-col items-center text-center">
                  <span className="font-micro text-micro uppercase tracking-[0.2em] text-brand-orange-dark mb-4">Verse of the Day</span>
                  <div className="max-w-2xl">
                    <blockquote className="font-body text-headline-h2 md:text-display text-on-surface italic leading-relaxed mb-6">{verse.text}</blockquote>
                    <cite className="font-display text-headline-h4 not-italic text-on-surface-variant opacity-80">— {verse.reference} ({verse.version})</cite>
                    <div className="mt-6 flex items-center justify-center gap-6">
                      <button
                        onClick={() => addToast('Share coming soon.', 'info')}
                        className="flex items-center gap-1.5 text-small text-on-surface-variant hover:text-brand-orange-dark transition-colors"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">share</span>
                        <span>Share</span>
                      </button>
                      <button
                        onClick={() => addToast('Saved to your library.', 'success')}
                        className="flex items-center gap-1.5 text-small text-on-surface-variant hover:text-brand-orange-dark transition-colors"
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">bookmark</span>
                        <span>Save</span>
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section>
              <div className="flex items-center justify-between mb-4 px-2">
                <h2 className="font-display text-headline-h3 text-on-surface">Announcements</h2>
                <button className="text-primary font-display text-small font-bold hover:underline">View All</button>
              </div>

              {loading ? (
                <div className="flex flex-col gap-4">
                  <SkeletonCard lines={2} />
                  <SkeletonCard lines={2} />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {announcements.map((a) => {
                    const cat = getCategoryConfig(a.category);
                    return (
                      <div key={a.id} className="bg-surface border border-outline-variant rounded-lg p-6 flex gap-6 hover:shadow-md transition-shadow cursor-pointer">
                        <div className={`w-16 h-16 rounded-lg flex items-center justify-center shrink-0 ${cat.iconBg}`}>
                          <span className="material-symbols-outlined text-3xl">{cat.icon}</span>
                        </div>
                        <div>
                          <h3 className="font-display text-headline-h4 text-on-surface mb-1">{a.title}</h3>
                          <p className="font-body text-body text-on-surface-variant line-clamp-2">{a.body}</p>
                          <div className="mt-3 flex items-center gap-4">
                            <span className="font-micro text-micro text-outline">{timeAgo(a.publishedAt ?? a.createdAt)}</span>
                            <span className={`px-2 py-0.5 ${cat.badgeClass} text-micro rounded uppercase font-bold tracking-tighter`}>{cat.label}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {announcements.length === 0 && (
                    <p className="text-on-surface-variant text-center py-12">No announcements yet.</p>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar Column (4 units) */}
          <aside className="lg:col-span-4 flex flex-col gap-8">
            <section className="bg-surface-container-low rounded-xl border border-outline-variant p-6">
              <h2 className="font-display text-headline-h4 text-on-surface mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">diversity_3</span>
                Latest Groups Update
              </h2>
              <div className="flex flex-col gap-6">
                {groups.slice(0, 3).map((g) => {
                  const meta = getGroupMeta(g.slug, timeAgo(g.createdAt));
                  return (
                    <div key={g.id} className="flex gap-4">
                      <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant shrink-0 flex items-center justify-center overflow-hidden">
                        {meta.imageUrl ? (
                          <img className="w-full h-full object-cover" src={meta.imageUrl} alt={g.name} />
                        ) : (
                          <span className="text-xs font-bold text-on-surface-variant">{g.name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-small text-small text-on-surface-variant leading-snug">
                          <strong className="text-on-surface">{g.name}</strong>{' '}
                          {g.slug === 'the-bereans' ? (
                            <>discussed <span className="italic text-primary">Acts 17</span> and shared 12 new reflections.</>
                          ) : (
                            meta.activityText(g.name, g.memberCount)
                          )}
                        </p>
                        <span className="font-micro text-micro text-outline">{meta.timeLabel}</span>
                      </div>
                    </div>
                  );
                })}
                {groups.length === 0 && !loading && (
                  <p className="font-small text-small text-on-surface-variant text-center">No groups yet.</p>
                )}
              </div>
              <button className="w-full mt-6 py-2 border border-primary text-primary font-display text-small font-bold rounded-md hover:bg-primary-container/10 transition-colors">
                Discover More Groups
              </button>
            </section>

            <section className="bg-paper border-2 border-dashed border-outline-variant rounded-xl p-6 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-primary-container/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">add_circle</span>
              </div>
              <h3 className="font-display text-headline-h4 text-on-surface">Quick Track</h3>
              <p className="font-body text-small text-on-surface-variant mt-1">Log your progress for today&apos;s reading in one click.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {QUICK_TRACK_CHAPTERS.map((ch) => (
                  <button key={ch} className="px-3 py-1 bg-surface-container rounded-full text-micro font-bold border border-outline-variant hover:bg-primary-fixed transition-colors">{ch}</button>
                ))}
              </div>
            </section>
          </aside>
        </div>

      {/* ═══════════════════════════════════════════════════════════
          FAB
          ═══════════════════════════════════════════════════════════ */}
      <div className="fixed bottom-24 right-6 md:bottom-10 md:right-10 z-50">
        <button className="w-14 h-14 bg-brand-orange-dark text-on-primary rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform group">
          <span className="material-symbols-outlined text-[28px] group-hover:rotate-90 transition-transform duration-300">edit</span>
        </button>
      </div>
    </>
  );
}
