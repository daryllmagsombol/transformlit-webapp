'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { gql } from '@apollo/client';
import { useToast } from '../../components/ui';
import { useAuthStore } from '../../store';
import { apolloClient } from '../../lib/apollo-client';

const FEED_QUERY = gql`
  query Feed {
    announcements {
      id
      title
      body
      status
      category
      publishedAt
      createdAt
    }
    verseOfDay {
      date
      text
      reference
      version
    }
  }
`;

const GROUPS_QUERY = gql`
  query Groups {
    groups {
      id
      name
      slug
      description
      memberCount
      visibility
      createdAt
    }
  }
`;

type Announcement = {
  id: string;
  title: string;
  body: string;
  status: string;
  category: string;
  publishedAt?: string | null;
  createdAt: string;
};

type VerseOfDay = {
  date: string;
  text: string;
  reference: string;
  version: string;
};

type Group = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  memberCount: number;
  visibility: string;
  createdAt: string;
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function FeedClient() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { addToast } = useToast();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [verse, setVerse] = useState<VerseOfDay | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [feedResult, groupsResult] = await Promise.all([
        apolloClient.query({ query: FEED_QUERY }),
        apolloClient.query({ query: GROUPS_QUERY }),
      ]);
      setAnnouncements(feedResult.data.announcements ?? []);
      setVerse(feedResult.data.verseOfDay ?? null);
      setGroups(groupsResult.data.groups ?? []);
    } catch (err) {
      console.error('Feed query failed:', err);
      addToast('Failed to load feed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    loadData();
  }, [token, router, loadData]);

  if (!token) return null;

  const quickChapters = ['Romans 12', 'Psalms 23', 'Matthew 5'];

  const groupActivityText = (g: Group): string => {
    const texts: Record<string, string> = {
      'the-bereans': 'discussed Acts 17 and shared 12 new reflections.',
      'morning-devotionals': 'completed their 50th consecutive day of reading!',
      'seed-and-harvest': 'welcomed 4 new members to the fellowship.',
    };
    return texts[g.slug] ?? `${g.memberCount} member${g.memberCount !== 1 ? 's' : ''}`;
  };

  const groupTimeAgo = (g: Group): string => {
    const times: Record<string, string> = {
      'the-bereans': '15 minutes ago',
      'morning-devotionals': '1 hour ago',
      'seed-and-harvest': '3 hours ago',
    };
    return times[g.slug] ?? timeAgo(g.createdAt);
  };

  const groupImages: Record<string, string> = {
    'the-bereans':
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCPlHLTAhP434zlz74HTe0jjiH9C0d3Ix7-E9u8YSr9VH_PwfX_AzAsKwVsbU-5kLPCgJzS_Ijy18P5dbH5nqwq0crZyGY7PzD-ZVHv-d82TdO8jR_CjVEW-Lx82eMrhneCavEGWAneWFPasgUg_BvquGpy67I4N2jCi_wq6h9ynSfjmxMPS3Oe53sX5UNVaLeEz1CV6GpQLmg37RHmpLJNi2VgvP8D3ibc1t0s0FGonZu602MR6WMTf6n7jPlHc7kFXAjj6Sq4xZRe',
    'morning-devotionals':
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCiyNA6uERBu7LgkO3BM-5AMusjQdpPq1c7Y95zx3dseMAlSg6MlxZ6ORJvXc-VbKtAszVAzIZ4G__grklMP2VGF1PXd59P1k-fEuoG5YDgLzvSj-M73DF9jxan2fJTx4fpOHLUM6HYLeg8vDDch7TmNWUYqESUqFM3Rw02YyBUsywv4B1ej2EFHq_fQOp1eNashiz23nN_qgDVGuRYYiPfgya_8YgBBYyhpg9my9L0aHNfegVIaYjmFt1TmklACA12okyz5Dhlrd0g',
    'seed-and-harvest':
      'https://lh3.googleusercontent.com/aida-public/AB6AXuBpZiy4idTFUVOuhZ_FBDWOlNje8w2ZT2kwdQQqD0zO4V81ERUIjsUV9kB1Lnk_CVCQ_cQ2H5r7mDhE6AQVi1DUmi3-ZFW8BKvq9zwq7_mcX5o7KRdsC1RCdrXuEW7h9nTbA3dIyF08OPFM4pY-sq_dnpmG8NtU-_Fc3m25E9Z2SBlC5KNGIagPGDhAEhD80fBNvaJOATSsjmMKjR5YNZ0_ItqGQXv0xQNODGWytqef7vNuzzxWbcp2b2PbHlDFOInDlR1MLz5gmrf3',
  };

  const categoryIcon = (c: string) => {
    if (c === 'EVENT') return 'event_available';
    if (c === 'UPDATE') return 'campaign';
    return 'info';
  };

  const categoryBadge = (c: string) => {
    if (c === 'EVENT') {
      return (
        <span className="px-2 py-0.5 bg-secondary-fixed text-on-secondary-fixed text-micro rounded uppercase font-bold tracking-tighter">
          Event
        </span>
      );
    }
    if (c === 'UPDATE') {
      return (
        <span className="px-2 py-0.5 bg-tertiary-fixed text-on-tertiary-fixed text-micro rounded uppercase font-bold tracking-tighter">
          Update
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 bg-outline-variant/50 text-on-surface-variant text-micro rounded uppercase font-bold tracking-tighter">
        General
      </span>
    );
  };

  const categoryIconBg = (c: string) => {
    if (c === 'EVENT') return 'bg-secondary-container text-on-secondary-container';
    if (c === 'UPDATE') return 'bg-tertiary-container/30 text-tertiary';
    return 'bg-surface-container-high text-on-surface-variant';
  };

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          TOP NAV BAR
          ═══════════════════════════════════════════════════════════ */}
      <header className="flex justify-between items-center h-16 px-4 md:px-5 w-full fixed top-0 bg-surface dark:bg-surface-dark z-50 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="md:hidden material-symbols-outlined text-primary cursor-pointer">menu</span>
          <h1 className="font-display text-headline-h3 font-bold text-primary dark:text-primary-fixed">Transformlit</h1>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <nav className="flex gap-6 items-center">
            <Link className="text-primary font-bold border-b-2 border-primary py-2 font-display text-headline-h4" href="/feed">
              Feed
            </Link>
            <Link className="text-on-surface-variant font-medium hover:text-primary transition-colors py-2 font-display text-headline-h4" href="/books">
              Library
            </Link>
            <Link className="text-on-surface-variant font-medium hover:text-primary transition-colors py-2 font-display text-headline-h4" href="/groups">
              Community
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex bg-surface-container-high px-4 py-1.5 rounded-full items-center gap-2 border border-outline-variant">
            <span className="material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
            <input
              className="bg-transparent border-none focus:ring-0 text-small font-small p-0 w-48 placeholder-on-surface-variant/60"
              placeholder="Search scripture, books..."
              type="text"
            />
          </div>
          <button className="material-symbols-outlined text-on-surface-variant cursor-pointer p-2 hover:bg-surface-container rounded-full transition-colors">
            notifications
          </button>
          <div className="w-9 h-9 rounded-full bg-primary-fixed overflow-hidden border border-primary/20 flex items-center justify-center">
            {user?.avatarUrl ? (
              <img className="w-full h-full object-cover" src={user.avatarUrl} alt={user.displayName} />
            ) : (
              <span className="text-xs font-bold text-on-primary-container">{user?.displayName?.charAt(0)?.toUpperCase() ?? 'U'}</span>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════
          SIDE NAV BAR (Desktop)
          ═══════════════════════════════════════════════════════════ */}
      <aside className="fixed left-0 top-0 h-full w-[240px] hidden md:flex flex-col bg-surface-container-low dark:bg-surface-container-lowest border-r border-outline-variant pt-16 z-40">
        <div className="p-6 flex flex-col gap-6 h-full">
          <div className="flex flex-col gap-1">
            <div className="bg-primary-container dark:bg-primary-fixed-variant text-on-primary-container border-l-4 border-primary px-4 py-3 flex items-center gap-3 font-bold cursor-pointer transition-transform active:translate-x-1">
              <span className="material-symbols-outlined filled">dynamic_feed</span>
              <span className="font-micro text-micro uppercase tracking-wider">Feed</span>
            </div>
            <Link href="/friends" className="text-on-surface-variant hover:bg-surface-container-highest px-4 py-3 flex items-center gap-3 transition-all cursor-pointer">
              <span className="material-symbols-outlined">group</span>
              <span className="font-micro text-micro uppercase tracking-wider">Friends</span>
            </Link>
            <Link href="/groups" className="text-on-surface-variant hover:bg-surface-container-highest px-4 py-3 flex items-center gap-3 transition-all cursor-pointer">
              <span className="material-symbols-outlined">diversity_3</span>
              <span className="font-micro text-micro uppercase tracking-wider">Groups</span>
            </Link>
            <Link href="/books" className="text-on-surface-variant hover:bg-surface-container-highest px-4 py-3 flex items-center gap-3 transition-all cursor-pointer">
              <span className="material-symbols-outlined">menu_book</span>
              <span className="font-micro text-micro uppercase tracking-wider">Books</span>
            </Link>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant">
            <h3 className="font-display text-micro uppercase tracking-widest text-on-surface-variant px-4 mb-3">Your Progress</h3>
            <div className="bg-paper-warm/50 rounded-lg p-4 border border-outline-variant shadow-sm">
              <div className="flex justify-between items-end mb-2">
                <span className="font-small text-small text-on-surface-variant">Yearly Goal</span>
                <span className="font-headline-h4 text-headline-h4 text-primary">12/24</span>
              </div>
              <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                <div className="bg-brand-orange-dark h-full" style={{ width: '50%' }} />
              </div>
              <p className="font-micro text-micro text-on-surface-variant mt-3 italic text-center">
                &ldquo;Steady steps lead to deep wisdom.&rdquo;
              </p>
              <button className="mt-4 w-full py-2 bg-primary text-on-primary rounded-md font-display text-small font-bold flex items-center justify-center gap-2 hover:bg-brand-orange-dark transition-colors active:scale-95">
                <span className="material-symbols-outlined text-[18px]">auto_stories</span>
                Track Progress
              </button>
            </div>
          </div>
          <div className="mt-auto pb-8 flex flex-col gap-1">
            <div className="text-on-surface-variant hover:bg-surface-container-highest px-4 py-2 flex items-center gap-3 transition-all cursor-pointer">
              <span className="material-symbols-outlined">settings</span>
              <span className="font-micro text-micro uppercase tracking-wider">Settings</span>
            </div>
            <div className="text-on-surface-variant hover:bg-surface-container-highest px-4 py-2 flex items-center gap-3 transition-all cursor-pointer">
              <span className="material-symbols-outlined">help</span>
              <span className="font-micro text-micro uppercase tracking-wider">Help</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════
          MAIN CONTENT
          ═══════════════════════════════════════════════════════════ */}
      <main className="pt-20 pb-24 md:pb-8 md:pl-[240px] min-h-screen">
        <div className="max-w-[1200px] mx-auto px-4 md:px-5 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* ── Feed Column (8 units) ─────────────────────────── */}
          <div className="lg:col-span-8 flex flex-col gap-8">
            {/* Verse of the Day — Bento Hero */}
            {verse && (
              <section className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary-container to-brand-orange-dark rounded-xl blur opacity-25 group-hover:opacity-40 transition duration-1000" />
                <div className="relative bg-paper border border-primary/20 rounded-xl overflow-hidden shadow-sm p-8 md:p-12 flex flex-col items-center text-center">
                  <span className="font-micro text-micro uppercase tracking-[0.2em] text-brand-orange-dark mb-4">
                    Verse of the Day
                  </span>
                  <div className="max-w-2xl">
                    <blockquote className="font-body text-headline-h2 md:text-display text-on-surface italic leading-relaxed mb-6">
                      {verse.text}
                    </blockquote>
                    <cite className="font-display text-headline-h4 not-italic text-on-surface-variant opacity-80">
                      — {verse.reference} ({verse.version})
                    </cite>
                  </div>
                  <div className="flex gap-4 mt-8">
                    <button className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors">
                      <span className="material-symbols-outlined">share</span>
                      <span className="font-small text-small">Share</span>
                    </button>
                    <button className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors">
                      <span className="material-symbols-outlined">bookmark</span>
                      <span className="font-small text-small">Save</span>
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Announcements */}
            <section>
              <div className="flex items-center justify-between mb-4 px-2">
                <h2 className="font-display text-headline-h3 text-on-surface">Announcements</h2>
                <button className="text-primary font-display text-small font-bold hover:underline">View All</button>
              </div>

              {loading && (
                <div className="flex flex-col gap-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="bg-surface border border-outline-variant rounded-lg p-6 flex gap-6 animate-pulse">
                      <div className="w-16 h-16 rounded-lg bg-surface-container-high shrink-0" />
                      <div className="flex-1">
                        <div className="h-5 bg-surface-container-high rounded w-3/4 mb-2" />
                        <div className="h-4 bg-surface-container-high rounded w-full mb-2" />
                        <div className="h-4 bg-surface-container-high rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && (
                <div className="flex flex-col gap-4">
                  {announcements.map((a) => (
                    <div key={a.id} className="bg-surface border border-outline-variant rounded-lg p-6 flex gap-6 hover:shadow-md transition-shadow cursor-pointer">
                      <div className={`w-16 h-16 rounded-lg flex items-center justify-center shrink-0 ${categoryIconBg(a.category)}`}>
                        <span className="material-symbols-outlined text-3xl">{categoryIcon(a.category)}</span>
                      </div>
                      <div>
                        <h3 className="font-display text-headline-h4 text-on-surface mb-1">{a.title}</h3>
                        <p className="font-body text-body text-on-surface-variant line-clamp-2">{a.body}</p>
                        <div className="mt-3 flex items-center gap-4">
                          <span className="font-micro text-micro text-outline">
                            {a.publishedAt ? timeAgo(a.publishedAt) : timeAgo(a.createdAt)}
                          </span>
                          {categoryBadge(a.category)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {announcements.length === 0 && (
                    <p className="text-on-surface-variant text-center py-12">No announcements yet.</p>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ── Sidebar Column (4 units) ───────────────────────── */}
          <aside className="lg:col-span-4 flex flex-col gap-8">
            {/* Latest Groups Activity */}
            <section className="bg-surface-container-low rounded-xl border border-outline-variant p-6">
              <h2 className="font-display text-headline-h4 text-on-surface mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">diversity_3</span>
                Latest Groups Update
              </h2>
              <div className="flex flex-col gap-6">
                {groups.slice(0, 3).map((g) => (
                  <div key={g.id} className="flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-outline-variant shrink-0 flex items-center justify-center overflow-hidden">
                      {groupImages[g.slug] ? (
                        <img className="w-full h-full object-cover" src={groupImages[g.slug]} alt={g.name} />
                      ) : (
                        <span className="text-xs font-bold text-on-surface-variant">{g.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-small text-small text-on-surface-variant leading-snug">
                        <strong className="text-on-surface">{g.name}</strong>{' '}
                        {g.slug === 'the-bereans' ? (
                          <>
                            discussed <span className="italic text-primary">Acts 17</span> and shared 12 new reflections.
                          </>
                        ) : (
                          groupActivityText(g)
                        )}
                      </p>
                      <span className="font-micro text-micro text-outline">{groupTimeAgo(g)}</span>
                    </div>
                  </div>
                ))}
                {groups.length === 0 && !loading && (
                  <p className="font-small text-small text-on-surface-variant text-center">No groups yet.</p>
                )}
              </div>
              <button className="w-full mt-6 py-2 border border-primary text-primary font-display text-small font-bold rounded-md hover:bg-primary-container/10 transition-colors">
                Discover More Groups
              </button>
            </section>

            {/* Quick Track Widget */}
            <section className="bg-paper border-2 border-dashed border-outline-variant rounded-xl p-6 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-primary-container/20 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-primary">add_circle</span>
              </div>
              <h3 className="font-display text-headline-h4 text-on-surface">Quick Track</h3>
              <p className="font-body text-small text-on-surface-variant mt-1">
                Log your progress for today&apos;s reading in one click.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {quickChapters.map((ch) => (
                  <button key={ch} className="px-3 py-1 bg-surface-container rounded-full text-micro font-bold border border-outline-variant hover:bg-primary-fixed transition-colors">
                    {ch}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════════════
          BOTTOM NAV BAR (Mobile Only)
          ═══════════════════════════════════════════════════════════ */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-1 md:hidden bg-paper-warm shadow-lg border-t border-outline-variant">
        <Link className="flex flex-col items-center justify-center bg-secondary-container text-on-secondary-container rounded-full px-4 py-1" href="/feed">
          <span className="material-symbols-outlined filled">dynamic_feed</span>
          <span className="font-micro text-[10px]">Feed</span>
        </Link>
        <Link className="flex flex-col items-center justify-center text-on-surface-variant py-2" href="/friends">
          <span className="material-symbols-outlined">group</span>
          <span className="font-micro text-[10px]">Friends</span>
        </Link>
        <Link className="flex flex-col items-center justify-center text-on-surface-variant py-2" href="/groups">
          <span className="material-symbols-outlined">diversity_3</span>
          <span className="font-micro text-[10px]">Groups</span>
        </Link>
        <Link className="flex flex-col items-center justify-center text-on-surface-variant py-2" href="/books">
          <span className="material-symbols-outlined">menu_book</span>
          <span className="font-micro text-[10px]">Books</span>
        </Link>
      </nav>

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
