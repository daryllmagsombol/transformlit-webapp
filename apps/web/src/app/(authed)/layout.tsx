"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearAuthState,
  getAuthToken,
  getStoredTenant,
  getStoredUser,
} from "@/lib/auth-storage";

const navItems = [
  { href: "/friends", label: "Friends" },
  { href: "/groups", label: "Groups" },
  { href: "/books", label: "Books" },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  "/announcements": {
    title: "Announcements",
    description: "Latest updates from your tenant",
  },
  "/friends": {
    title: "Friends",
    description: "People you read with across the community",
  },
  "/groups": {
    title: "Groups",
    description: "Organize readers into focused circles",
  },
  "/books": {
    title: "Books",
    description: "Manage PDFs and access rules",
  },
};

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getAuthToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  const meta = useMemo(() => {
    if (!pathname) return pageMeta["/announcements"];
    return pageMeta[pathname] ?? pageMeta["/announcements"];
  }, [pathname]);

  if (!ready) {
    return null;
  }

  const tenant = getStoredTenant();
  const user = getStoredUser();

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="hidden w-64 flex-col border-r border-ink/10 bg-paper md:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <Link
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-ink bg-brand text-base font-semibold text-ink"
            href="/announcements"
          >
            TL
          </Link>
          <div>
            <p className="text-base font-semibold text-ink">Transformlit</p>
            <p className="text-xs text-ink-soft">Community Console</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-2 px-4">
          <Link
            href="/announcements"
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              pathname === "/announcements"
                ? "border-ink/20 bg-paper-warm text-ink"
                : "border-transparent text-ink hover:border-ink/10 hover:bg-paper-warm"
            }`}
          >
            Announcements
          </Link>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                pathname === item.href
                  ? "border-ink/20 bg-paper-warm text-ink"
                  : "border-transparent text-ink hover:border-ink/10 hover:bg-paper-warm"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-6 pb-6 text-xs text-ink-soft">
          {tenant?.name ?? "Tenant"} · {user?.email ?? "admin"}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-ink/10 bg-paper px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-ink">{meta.title}</p>
            <p className="text-xs text-ink-soft">{meta.description}</p>
          </div>
          <div className="flex items-center gap-3">
            {pathname === "/announcements" ? (
              <button className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink">
                Create announcement
              </button>
            ) : null}
            <button
              className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold text-ink"
              onClick={() => {
                clearAuthState();
                router.push("/");
              }}
            >
              Log out
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-ink bg-brand text-xs font-semibold text-ink">
              TL
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
