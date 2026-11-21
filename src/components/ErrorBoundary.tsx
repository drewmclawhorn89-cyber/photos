import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Something went wrong.',
    };
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string };
        if (parsed?.error) friendly = parsed.error;
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-dvh bg-black text-white flex items-center justify-center p-6">
          <div className="max-w-sm w-full rounded-2xl bg-zinc-950 border border-white/15 p-6 space-y-4 text-center">
            <h1 className="text-lg font-bold text-white">Unable to load library</h1>
            <p className="text-xs text-zinc-400 break-words">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full h-11 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
