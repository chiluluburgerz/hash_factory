import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import useAppContext from "@/app/hooks/useAppContext.js";

export default function SetupGate() {
  const { isLoading, isAuthenticated, setup } = useAppContext();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading workspace...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const isSetupRoute = location.pathname === "/app/setup";
  const shouldGate = Boolean(setup?.shouldGate);

  if (shouldGate && !isSetupRoute) {
    return <Navigate to="/app/setup" replace state={{ from: location }} />;
  }

  return <Outlet />;
}