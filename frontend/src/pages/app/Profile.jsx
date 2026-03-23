import React from "react";
import { UserRound } from "lucide-react";

import EntitySection from "@/components/base/entity-section.jsx";
import UserProfileEditor from "@/components/users/userProfileEditor.jsx";

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Profile
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review and update the personal identity fields associated with your authenticated Hash Factory workspace.
        </p>
      </div>

      <EntitySection
        title="Profile details"
        description="These values identify your user account inside the current workspace."
      >
        <div className="rounded-2xl border border-border/60 bg-card/25 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground/90">
            <UserRound className="h-4 w-4" />
            User profile
          </div>

          <UserProfileEditor />
        </div>
      </EntitySection>
    </div>
  );
}