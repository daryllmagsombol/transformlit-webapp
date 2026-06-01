"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { register } from "@/lib/api";
import { setAuthState } from "@/lib/auth-storage";
import { ErrorState } from "@/components/ErrorState";

export default function RegisterPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      setAuthState(data.token, data.tenant, data.user);
      router.push("/announcements");
    },
  });

  const errorMessage =
    mutation.error instanceof Error
      ? mutation.error.message
      : "Registration failed";

  return (
    <div className="min-h-screen bg-paper px-6 py-12">
      <div className="mx-auto w-full max-w-md rounded-3xl border border-ink/10 bg-paper-warm p-8">
        <h1 className="text-2xl font-semibold text-ink">Create your account</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Start a new tenant and invite your community.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({ tenantName, email, password });
          }}
        >
          <label className="block text-sm font-semibold text-ink">
            Tenant name
            <input
              type="text"
              className="mt-2 w-full rounded-xl border border-ink/20 bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-ink"
              placeholder="Transformlit Readers"
              value={tenantName}
              onChange={(event) => setTenantName(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Email
            <input
              type="email"
              className="mt-2 w-full rounded-xl border border-ink/20 bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-ink"
              placeholder="you@transformlit.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Password
            <input
              type="password"
              className="mt-2 w-full rounded-xl border border-ink/20 bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-ink"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mutation.isError ? <ErrorState message={errorMessage} /> : null}
          <button
            type="submit"
            className="w-full rounded-full border-2 border-ink bg-brand px-5 py-3 text-sm font-semibold text-ink transition hover:bg-brand-dark"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Creating account..." : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-ink-soft">
          Already have an account?{" "}
          <Link className="font-semibold text-ink" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
