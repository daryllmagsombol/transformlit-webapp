'use client';

import { useState, useEffect, useCallback } from 'react';
import { gql } from '@apollo/client';
import type { GraphQLGroup } from '@transformlit/shared';
import { useToast, GroupCard, CategoryChip, FeaturedGroupCard, CompactGroupCard, LoadingSpinner } from '../../components/ui';
import { apolloClient } from '../../lib/apollo-client';
import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { GROUP_CATEGORIES } from '../../lib/constants';

// ── GraphQL ─────────────────────────────────────────────────────────────────

const MY_GROUPS_QUERY = gql`
  query MyGroups {
    myGroups { id name slug description category coverImageUrl memberCount featured createdAt }
  }
`;

const DISCOVER_GROUPS_QUERY = gql`
  query DiscoverGroups($category: GroupCategory) {
    discoverGroups(category: $category) {
      id name slug description category coverImageUrl featured memberCount createdAt
    }
  }
`;

const JOIN_GROUP_MUTATION = gql`
  mutation JoinGroup($groupId: String!) {
    joinGroup(groupId: $groupId) { id role status }
  }
`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function compactGroupMeta(category?: string | null) {
  const map: Record<string, { icon: string; bg: string; subtitle: string }> = {
    BIBLICAL_STUDIES: { icon: 'temple_hindu', bg: 'bg-accent-teal-light text-white', subtitle: 'Biblical & Theological Studies' },
    MODERN_FICTION: { icon: 'auto_stories', bg: 'bg-primary-container text-on-primary-container', subtitle: 'Modern Fiction & Prose' },
    HISTORICAL: { icon: 'history_edu', bg: 'bg-secondary-container text-on-secondary-container', subtitle: 'Historical Literature' },
    PHILOSOPHY: { icon: 'psychology', bg: 'bg-tertiary-fixed text-on-tertiary-fixed', subtitle: 'Philosophy & Wisdom' },
    YOUNG_ADULT: { icon: 'child_care', bg: 'bg-surface-variant text-on-surface-variant', subtitle: 'Young Adult & Poetry' },
  };
  return map[category ?? ''] ?? { icon: 'diversity_3', bg: 'bg-surface-container-high text-on-surface-variant', subtitle: 'General Reading' };
}

// ── Groups Page ─────────────────────────────────────────────────────────────

export default function GroupsClient() {
  const { isReady } = useRequireAuth();
  const { addToast } = useToast();

  const [myGroups, setMyGroups] = useState<GraphQLGroup[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<GraphQLGroup[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      const [myResult, discoverResult] = await Promise.all([
        apolloClient.query({ query: MY_GROUPS_QUERY }),
        apolloClient.query({
          query: DISCOVER_GROUPS_QUERY,
          variables: { category: selectedCategory || null },
        }),
      ]);
      setMyGroups(myResult.data.myGroups ?? []);
      setDiscoverGroups(discoverResult.data.discoverGroups ?? []);
    } catch {
      addToast('Failed to load groups.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, addToast]);

  useEffect(() => {
    if (isReady) loadData();
  }, [isReady, loadData]);

  const handleJoinGroup = useCallback(
    async (groupId: string) => {
      setJoining((prev) => new Set(prev).add(groupId));
      try {
        await apolloClient.mutate({
          mutation: JOIN_GROUP_MUTATION,
          variables: { groupId },
        });
        addToast('Joined group! Welcome aboard.', 'success');
        loadData();
      } catch {
        addToast('Failed to join group. Please try again.', 'error');
      } finally {
        setJoining((prev) => { const next = new Set(prev); next.delete(groupId); return next; });
      }
    },
    [addToast, loadData],
  );

  if (!isReady) {
    return <LoadingSpinner />;
  }

  // Split discover into featured (first featured group) + rest
  const featuredDiscover = discoverGroups.find((g) => g.featured);
  const sideDiscover = discoverGroups.filter((g) => !g.featured);

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          HERO HEADER
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-8">
        <div className="relative overflow-hidden rounded-xl h-48 md:h-64 flex items-end p-6 md:p-10 mb-8 bg-paper-warm shadow-sm">
          <div className="relative z-10 flex flex-col gap-2">
            <h1 className="font-display text-display-mobile md:text-display text-on-surface leading-tight">
              Your Reading Circles
            </h1>
            <p className="font-body text-body md:text-headline-h4 text-on-surface-variant max-w-lg">
              Transformative reading happens in community. Explore your current groups or discover new perspectives.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════
          ACTIVE GROUPS
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-12">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-headline-h2 text-on-surface">Active Groups</h2>
        </div>

        {loading ? (
          <div className="flex gap-6 overflow-x-auto pb-4">
            <div className="min-w-[300px] h-72 bg-surface-container-high rounded-xl animate-pulse" />
            <div className="min-w-[300px] h-72 bg-surface-container-high rounded-xl animate-pulse" />
          </div>
        ) : myGroups.length > 0 ? (
          <div className="bento-grid">
            {myGroups.map((g) => (
              <GroupCard
                key={g.id}
                name={g.name}
                slug={g.slug}
                description={g.description}
                coverImageUrl={g.coverImageUrl}
                memberCount={g.memberCount}
                category={g.category}
              />
            ))}
          </div>
        ) : (
          <p className="font-body text-body text-on-surface-variant text-center py-12">
            You haven&apos;t joined any groups yet. Discover one below!
          </p>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════
          DISCOVER GROUPS
          ═══════════════════════════════════════════════════════════ */}
      <section className="mb-12">
        <div className="flex items-center gap-4 mb-8">
          <h2 className="font-display text-headline-h2 text-on-surface">Discover Groups</h2>
          <div className="h-px flex-1 bg-outline-variant" />
        </div>

        {/* Categories */}
        <div className="flex gap-4 overflow-x-auto pb-6 no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          {GROUP_CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat.key}
              label={cat.label}
              icon={cat.icon}
              active={selectedCategory === cat.key}
              onClick={() =>
                setSelectedCategory((prev) => (prev === cat.key ? null : cat.key))
              }
            />
          ))}
        </div>

        {/* Suggested Groups: Featured + Side cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-8 h-64 bg-surface-container-high rounded-2xl animate-pulse" />
            <div className="md:col-span-4 space-y-6">
              <div className="h-20 bg-surface-container-high rounded-2xl animate-pulse" />
              <div className="h-20 bg-surface-container-high rounded-2xl animate-pulse" />
            </div>
          </div>
        ) : discoverGroups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Featured card (larger) */}
            {featuredDiscover ? (
              <FeaturedGroupCard
                name={featuredDiscover.name}
                description={featuredDiscover.description}
                coverImageUrl={featuredDiscover.coverImageUrl}
                memberCount={featuredDiscover.memberCount}
              />
            ) : (
              <div className="md:col-span-8 bg-surface-container-low rounded-2xl p-8 text-center border border-outline-variant">
                <p className="font-body text-body text-on-surface-variant">
                  No featured groups in this category.
                </p>
              </div>
            )}

            {/* Side cards (smaller) */}
            <div className="md:col-span-4 flex flex-col gap-6">
              {sideDiscover.slice(0, 3).map((g) => {
                const meta = compactGroupMeta(g.category);
                return (
                  <CompactGroupCard
                    key={g.id}
                    name={g.name}
                    description={meta.subtitle}
                    icon={meta.icon}
                    iconBg={meta.bg}
                    onClick={() => handleJoinGroup(g.id)}
                  />
                );
              })}
              {sideDiscover.length === 0 && (
                <p className="font-small text-small text-on-surface-variant text-center py-8">
                  No more groups to discover here.
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="font-body text-body text-on-surface-variant text-center py-12">
            No discoverable groups found{selectedCategory ? ' in this category' : ''}.
          </p>
        )}
      </section>
    </>
  );
}
