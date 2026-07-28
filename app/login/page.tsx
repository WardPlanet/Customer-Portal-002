"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from") ?? "/";
  const from = rawFrom.startsWith("/") ? rawFrom : "/";
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.ok) {
        router.push(from);
      } else {
        setError("Incorrect passphrase. Please try again.");
        setPassphrase("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block text-white text-xs font-semibold tracking-wide px-3 py-1 rounded-full mb-4" style={{ backgroundColor: "#0062B8" }}>
            Planet DDS
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Onboarding Portal</h1>
          <p className="mt-2 text-sm text-gray-500">Enter the passphrase to continue</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 px-8 py-8">
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-5">
              <label htmlFor="passphrase" className="block text-sm font-medium text-gray-700 mb-1.5">Passphrase</label>
              <input id="passphrase" type="password" autoComplete="off" value={passphrase}
                onChange={e => setPassphrase(e.target.value)} placeholder="Enter passphrase" required
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition" />
            </div>
            {error && <p className="mb-4 text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !passphrase}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: "#0062B8" }}>
              {loading ? "Verifying…" : "Continue"}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-xs text-gray-400">&copy; {new Date().getFullYear()} Planet DDS</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
