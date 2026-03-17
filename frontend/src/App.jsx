import React from "react";
import { BrowserRouter } from "react-router-dom";

import { getStoredApiKey, clearStoredApiKey } from "@/lib/apiClient.js";
import useAppContext from "@/app/hooks/useAppContext.js";
import ApiKeyGate from "@/app/auth/ApiKeyGate.jsx";
import { AppContextProvider } from "./app/providers/AppContextProvider.jsx";
import AppLayout from "./app/layout/AppLayout.jsx";
import AppRoutes from "./app/routes.jsx";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error("HF AppErrorBoundary caught:", err, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div className="min-h-screen bg-background text-foreground">
          <div className="mx-auto max-w-4xl px-6 py-10">
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
            <pre className="mt-4 overflow-auto rounded-xl border border-border/60 bg-card/40 p-4 text-xs text-foreground/85 whitespace-pre-wrap">
              {String(this.state.err?.stack || this.state.err)}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AuthBootstrapGuard({ onInvalidAuth, children }) {
  const { isLoading, authFailed } = useAppContext();

  React.useEffect(() => {
    if (!isLoading && authFailed) {
      clearStoredApiKey();
      onInvalidAuth?.();
    }
  }, [isLoading, authFailed, onInvalidAuth]);

  return children;
}

export default function App() {
  const [hasApiKey, setHasApiKey] = React.useState(() => !!getStoredApiKey());

  if (!hasApiKey) {
    return <ApiKeyGate onAuthenticated={() => setHasApiKey(true)} />;
  }

  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <AppContextProvider>
          <AuthBootstrapGuard onInvalidAuth={() => setHasApiKey(false)}>
            <AppLayout onSignedOut={() => setHasApiKey(false)}>
              <AppRoutes />
            </AppLayout>
          </AuthBootstrapGuard>
        </AppContextProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}