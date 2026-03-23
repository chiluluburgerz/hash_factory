import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import SetupGate from "@/components/setup/setupGate.jsx";

import OverviewPage from "@/pages/app/Overview.jsx";
import SetupPage from "@/pages/app/Setup.jsx";
import IngestPage from "@/pages/app/Ingest.jsx";
import IngestAnchorPage from "@/pages/app/IngestAnchor.jsx";
import IngestRequestsPage from "@/pages/app/IngestRequests.jsx";
import IngestRequestDetailPage from "@/pages/app/IngestRequestDetail.jsx";
import IngestSubmitPage from "@/pages/app/IngestSubmit.jsx";
import DatasetsPage from "@/pages/app/Datasets.jsx";
import DatasetDetailPage from "@/pages/app/DatasetDetail.jsx";
import DatasetAnchorPage from "@/pages/app/DatasetAnchor.jsx";
import DatasetSubmitPage from "@/pages/app/DatasetSubmit.jsx";
import CertificatesPage from "@/pages/app/Certificates.jsx";
import CertificateDetailPage from "@/pages/app/CertificateDetail.jsx";
import HederaOverviewPage from "@/pages/app/Hedera.jsx";
import HederaTopicsPage from "@/pages/app/HederaTopics.jsx";
import HederaTopicDetailPage from "@/pages/app/HederaTopicDetail.jsx";
import HederaHcsPage from "@/pages/app/HederaHcs.jsx";
import HederaHcsDetailPage from "@/pages/app/HederaHcsDetail.jsx";
import HederaHtsPage from "@/pages/app/HederaHts.jsx";
import HederaHtsDetailPage from "@/pages/app/HederaHtsDetail.jsx";
import HederaDecryptPage from "@/pages/app/HederaDecrypt.jsx";
import WalletsPage from "@/pages/app/Wallets.jsx";
import WalletDetailPage from "@/pages/app/WalletDetail.jsx";
import KeysPage from "@/pages/app/Keys.jsx";
import ApiKeysPage from "@/pages/app/ApiKeys.jsx";
import ApiKeyDetailPage from "@/pages/app/ApiKeyDetail.jsx";
import EncryptionKeysPage from "@/pages/app/EncryptionKeys.jsx";
import EncryptionKeyDetailPage from "@/pages/app/EncryptionKeyDetail.jsx";
import OrgPage from "@/pages/app/Orgs.jsx";
import ProfilePage from "@/pages/app/Profile.jsx";
import MembersPage from "@/pages/app/Members.jsx";
import VerifyPage from "@/pages/app/Verify.jsx";
import NotFoundPage from "@/pages/app/NotFound.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/overview" replace />} />
      <Route path="/app" element={<Navigate to="/app/overview" replace />} />

      <Route element={<SetupGate />}>
        <Route path="/app/setup" element={<SetupPage />} />
        <Route path="/app/overview" element={<OverviewPage />} />

        <Route path="/app/ingest" element={<IngestPage />} />
        <Route path="/app/ingest/anchor" element={<IngestAnchorPage />} />
        <Route path="/app/ingest/requests" element={<IngestRequestsPage />} />
        <Route path="/app/ingest/requests/:anchorRequestId" element={<IngestRequestDetailPage />} />
        <Route path="/app/ingest/submit" element={<IngestSubmitPage />} />

        <Route path="/app/datasets" element={<DatasetsPage />} />
        <Route path="/app/datasets/anchor" element={<DatasetAnchorPage />} />
        <Route path="/app/datasets/:datasetKey" element={<DatasetDetailPage />} />
        <Route path="/app/datasets/submit" element={<DatasetSubmitPage />} />

        <Route path="/app/certificates" element={<CertificatesPage />} />
        <Route path="/app/certificates/:certificateId/:proofDate" element={<CertificateDetailPage />} />

        <Route path="/app/hedera" element={<HederaOverviewPage />} />
        <Route path="/app/hedera/topics" element={<HederaTopicsPage />} />
        <Route path="/app/hedera/topics/:topicName" element={<HederaTopicDetailPage />} />
        <Route path="/app/hedera/hcs" element={<HederaHcsPage />} />
        <Route path="/app/hedera/hcs/messages/:messageId" element={<HederaHcsDetailPage />} />
        <Route path="/app/hedera/hcs/transactions/:transactionId" element={<HederaHcsDetailPage />} />
        <Route path="/app/hedera/hts" element={<HederaHtsPage />} />
        <Route path="/app/hedera/hts/transactions/:transactionId" element={<HederaHtsDetailPage />} />
        <Route path="/app/hedera/decrypt" element={<HederaDecryptPage />} />

        <Route path="/app/wallets" element={<WalletsPage />} />
        <Route path="/app/wallets/:walletId" element={<WalletDetailPage />} />

        <Route path="/app/keys" element={<KeysPage />} />
        <Route path="/app/api-keys" element={<ApiKeysPage />} />
        <Route path="/app/api-keys/:apiKeyId" element={<ApiKeyDetailPage />} />
        <Route path="/app/keys/encryption" element={<EncryptionKeysPage />} />
        <Route path="/app/keys/encryption/:userId/:keyVersion" element={<EncryptionKeyDetailPage />} />

        <Route path="/app/org" element={<OrgPage />} />
        <Route path="/app/org/members" element={<MembersPage />} />

        <Route path="/app/profile" element={<ProfilePage />} />

        <Route path="/app/verify" element={<VerifyPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}