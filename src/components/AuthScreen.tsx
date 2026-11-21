import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { getMissingR2Keys } from '../lib/r2';

export const AuthScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingR2Keys = getMissingR2Keys();

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      if (!msg.includes('popup-closed-by-user')) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black text-white flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto space-y-8">
        <div className="space-y-2.5">
          <h1 className="text-3xl font-bold tracking-tight text-white">My Photos</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Your private cloud photo and video library. Sign in with Google to sync albums, favorites, and uploads across every phone and computer.
          </p>
        </div>

        {missingR2Keys.length > 0 && (
          <div className="rounded-2xl bg-zinc-950 border border-white/10 p-4 space-y-2">
            <p className="text-xs font-semibold text-amber-400">Cloudflare R2 setup note</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your Cloud Firestore database is connected. Add these variables in your{' '}
              <code className="font-mono text-zinc-200">.env</code> file to enable direct media uploads to your R2 bucket:
            </p>
            <ul className="text-xs font-mono text-zinc-300 space-y-1 pt-1">
              {missingR2Keys.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-[#FE2C55]/10 border border-[#FE2C55]/30 px-3.5 py-2.5 text-xs text-[#FF6B86]"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleSignIn}
            className="w-full h-12 rounded-xl bg-white text-black font-semibold text-sm hover:bg-zinc-200 active:scale-[0.99] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
            )}
            <span>Continue with Google</span>
          </button>
        </div>

        <p className="text-xs text-zinc-500 text-center">
          Each account has isolated private storage and database records.
        </p>
      </div>
    </div>
  );
};
