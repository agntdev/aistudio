'use client';

import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // In production, send to Sentry here (we already set it up in T08)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-zinc-950 text-white">
          <div className="text-6xl mb-4">😵</div>
          <h2 className="text-2xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-zinc-400 mb-6 max-w-md">
            We&apos;ve been notified and are looking into it. Try refreshing the page.
          </p>
          <Button onClick={this.handleReset} variant="outline">
            Reload Page
          </Button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mt-8 p-4 bg-zinc-900 rounded text-left text-xs overflow-auto max-w-2xl text-red-400">
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
