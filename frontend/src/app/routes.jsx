import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import OverviewPage from "@/pages/app/Overview.jsx";
import IngestPage from "@/pages/app/Ingest.jsx";
import DatasetsPage from "@/pages/app/Datasets.jsx";
import DatasetDetailPage from "@/pages/app/DatasetDetail.jsx";
import DatasetAnchorPage from "@/pages/app/DatasetAnchor.jsx";
import DatasetSubmitPage from "@/pages/app/DatasetSubmit.jsx";
import CertificatesPage from "@/pages/app/Certificates.jsx";
import CertificateDetailPage from "@/pages/app/CertificateDetail.jsx";
import WalletsPage from "@/pages/app/Wallets.jsx";
import WalletDetailPage from "@/pages/app/WalletDetail.jsx";
import ApiKeysPage from "@/pages/app/ApiKeys.jsx";
import ApiKeyDetailPage from "@/pages/app/ApiKeyDetail.jsx";
import OrgPage from "@/pages/app/Orgs.jsx";
import MembersPage from "@/pages/app/Members.jsx";
import VerifyPage from "@/pages/app/Verify.jsx";
import ActivityPage from "@/pages/app/Activity.jsx";
import NotFoundPage from "@/pages/app/NotFound.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/overview" replace />} />

      <Route path="/app" element={<Navigate to="/app/overview" replace />} />
      <Route path="/app/overview" element={<OverviewPage />} />

      <Route path="/app/ingest" element={<IngestPage />} />

      <Route path="/app/datasets" element={<DatasetsPage />} />
      <Route path="/app/datasets/anchor" element={<DatasetAnchorPage />} />
      <Route path="/app/datasets/:datasetKey" element={<DatasetDetailPage />} />
      <Route path="/app/datasets/submit" element={<DatasetSubmitPage />} />

      <Route path="/app/certificates" element={<CertificatesPage />} />
      <Route path="/app/certificates/:certificateId/:proofDate" element={<CertificateDetailPage />} />

      <Route path="/app/wallets" element={<WalletsPage />} />
      <Route path="/app/wallets/:walletId" element={<WalletDetailPage />} />

      <Route path="/app/api-keys" element={<ApiKeysPage />} />
      <Route path="/app/api-keys/:apiKeyId" element={<ApiKeyDetailPage />} />

      <Route path="/app/org" element={<OrgPage />} />
      <Route path="/app/org/members" element={<MembersPage />} />

      <Route path="/app/verify" element={<VerifyPage />} />
      <Route path="/app/activity" element={<ActivityPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}