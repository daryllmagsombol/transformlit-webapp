"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchFriends,
  searchFriends,
  sendFriendRequest,
  PublicUser,
} from "../../../lib/api";
import { Button, Input } from "../../../components/FormFields";

export default function FriendsPage() {
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const { data: friends } = useQuery<PublicUser[]>({
    queryKey: ["friends"],
    queryFn: fetchFriends,
  });

  const search = useQuery({
    queryKey: ["friends", "search", query],
    queryFn: () => searchFriends(query),
    enabled: query.length > 0,
  });

  const sendRequest = useMutation({
    mutationFn: (addresseeId: string) => sendFriendRequest({ addresseeId }),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink">Friends</h1>

      <div className="rounded-2xl border border-ink/10 bg-paper p-6">
        <div className="mb-4">
          <Input
            label="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or email"
          />
        </div>

        {query.length > 0 ? (
          <div>
            {search.isLoading ? (
              <p>Searching…</p>
            ) : search.data && search.data.length > 0 ? (
              <ul className="space-y-2">
                {search.data.map((u: PublicUser) => (
                  <li key={u.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {u.profile?.displayName ?? u.email}
                      </div>
                      <div className="text-sm text-ink-soft">{u.email}</div>
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => sendRequest.mutate(u.id)}
                      >
                        Send Request
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">No results</p>
            )}
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-medium">Your friends</h2>
            {friends && friends.length > 0 ? (
              <ul className="space-y-2 mt-3">
                {friends.map((f: PublicUser) => (
                  <li key={f.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {f.profile?.displayName ?? f.email}
                      </div>
                      <div className="text-sm text-ink-soft">{f.email}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft mt-3">
                You have no friends yet. Start by sending a request.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
