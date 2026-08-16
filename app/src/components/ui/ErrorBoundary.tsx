import React from "react";
import { notifyError } from "../../lib/notify";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    notifyError(error instanceof Error ? error : String(error));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-surface p-8">
          <div className="max-w-md rounded-xl border border-red-500/40 bg-surface-container-high p-6 text-center">
            <p className="text-sm font-semibold text-on-surface">
              Something went wrong
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-snug text-on-surface-variant">
              {this.state.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="mt-4 rounded-lg border border-outline bg-surface-container px-3 py-1.5 text-[12px] text-on-surface transition-colors hover:bg-white/[0.06]"
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
