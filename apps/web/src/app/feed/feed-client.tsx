'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gql } from '@apollo/client';
import { Card, useToast } from '../../components/ui';
import { useAuthStore } from '../../store';
import { apolloClient } from '../../lib/apollo-client';

const FEED_QUERY = gql`
  query Feed {
    announcements { id title body status publishedAt createdAt }
    verseOfDay { date text reference version }
  }
`;

export default function FeedClient() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const { addToast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }

    apolloClient
      .query({ query: FEED_QUERY })
      .then((result) => {
        setData(result.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Feed query failed:', err);
        addToast('Failed to load feed. Please try again.', 'error');
        setLoading(false);
      });
  }, [token, router, addToast]);

  if (!token) return null;

  return (
    <div className="min-h-dvh bg-paper">
      {/* Simple top bar + sidebar replacement for SSR safety */}
      <header className="fixed top-0 left-0 right-0 z-50 h-[56px] bg-surface border-b border-border flex items-center justify-between px-4">
        <span className="font-bold text-lg text-brand">Transformlit</span>
        <button onClick={() => { useAuthStore.getState().clearAuth(); }} className="btn-ghost text-sm py-1">
          Logout
        </button>
      </header>
      <div className="pt-[56px] p-6 max-w-[1200px] mx-auto space-y-6">
        <h1 className="text-h2 font-bold">Feed</h1>

        {data?.verseOfDay && (
          <Card className="border-l-4 border-l-brand">
            <div className="flex items-start gap-4">
              <span className="text-3xl">📖</span>
              <div>
                <p className="text-sm text-ink-soft font-medium">Verse of the Day</p>
                <p className="text-body mt-2 italic font-serif leading-relaxed">
                  "{data.verseOfDay.text}"
                </p>
                <p className="text-sm text-accent mt-2 font-medium">
                  — {data.verseOfDay.reference} ({data.verseOfDay.version})
                </p>
              </div>
            </div>
          </Card>
        )}

        <h2 className="text-h4 font-semibold">Announcements</h2>
        {loading && <p className="text-ink-soft">Loading announcements...</p>}

        <div className="space-y-4">
          {data?.announcements?.map((a: any) => (
            <Card key={a.id}>
              <div className="flex items-start justify-between">
                <h3 className="text-h4 font-semibold">{a.title}</h3>
                <span className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-sm capitalize">
                  {a.status.toLowerCase()}
                </span>
              </div>
              <p className="text-body text-ink-soft mt-3">{a.body}</p>
              {a.publishedAt && (
                <p className="text-micro text-ink-soft mt-3">
                  {new Date(a.publishedAt).toLocaleDateString()}
                </p>
              )}
            </Card>
          ))}
          {data?.announcements?.length === 0 && !loading && (
            <p className="text-ink-soft text-center py-12">No announcements yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
