import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="p-4 m-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 flex flex-col gap-3">
          <div className="flex items-center gap-2 font-semibold text-xs text-red-400">
            <AlertCircle size={14} />
            <span>Component Error Occurred</span>
          </div>
          <p className="text-xs font-mono break-all opacity-80">
            {this.state.error?.message || "An unexpected error occurred in the UI."}
          </p>
          <button
            onClick={this.handleReset}
            className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-white transition-colors cursor-pointer"
          >
            <RotateCw size={12} />
            Retry Component
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
