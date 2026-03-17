import React from "react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The page you requested does not exist in this HF build.
      </p>
      <Link to="/app/overview" className="text-sm underline underline-offset-4">
        Return to overview
      </Link>
    </div>
  );
}