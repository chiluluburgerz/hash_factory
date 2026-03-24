# Hash Factory

**Hash Factory** is a user onboarding and data ingestion surface for verifiable science. It serves as a
Web2-to-Web3 ramp into Vera Anchor, which is a Hedera-native platform for verificable scientific workflows. It allows researchers and scientists to seamlessly and securely anchor their scientific datasets and results. 
Researchers and operators use Hash Factory to generate deterministic cryptographic evidence of dataset integrity, anchor that evidence to the Hedera Consensus Service (HCS), and receive HTS NFT certificates as tamper-evident proof of ownership and version state.

**Live demo:** [hf.veraanchor.com](https://hf.veraanchor.com)
**Demo video:** [Watch on YouTube](https://www.youtube.com/watch?v=HWb58sL3ryM)
**npm package:** [npmjs.com/package/hf-local](https://www.npmjs.com/package/hf-local)

---

## What it does

1. A user submits an ingestion request through the HF UI or the `hf-local` SDK
2. Hash Factory scans and hashes every file, builds a deterministic Merkle proof, and produces a dataset fingerprint
3. The evidence bundle is anchored to Hedera via HCS, creating an immutable, timestamped on-chain record
4. An HTS NFT certificate is minted and transferred to the user's provisioned Hedera wallet as a portable proof asset
5. Everything is verifiable: receipts, bundles, and HCS transactions can be independently verified

---

## Architecture

```
HF UI (React + Vite)
    ↓
HF API (Fastify / Node.js)       ← this repo
    ↓
Core Backend API                 ← dataset registry, wallet provisioning, Hedera orchestration
    ↓
Hedera Testnet                   ← HCS anchoring, HTS NFT minting + transfer
```

The HF API is containerized (Docker, Node 20 Alpine) and deployed behind a Caddy reverse proxy. It communicates with a Core backend that owns all registry state and Hedera interactions. The frontend is a React SPA served separately.

**Live deployment:**
- UI: [hf.veraanchor.com](https://hf.veraanchor.com)
- API: [hfapi.veraanchor.com](https://hfapi.veraanchor.com)

---

## Hedera integrations (live on testnet)

- **HCS anchoring** — every dataset evidence bundle is anchored as an HCS message
- **Wallet provisioning** — each user receives a managed Hedera wallet on signup
- **HTS NFT certificate minting** — dataset certificates are minted as NFTs on HTS
- **HTS NFT certificate transfer** — certificates are transferred to the user's wallet
- **Mirror node verification** — anchors are verified against the Hedera mirror node
- **HashScan Explorer links** — every HCS transaction links directly to HashScan

**Testnet tokens:**
- `VADSCERT` — `0.0.8206550`
- `VAMACERT` — `0.0.8220630`

---

## Repo structure

```
hash_factory/
├── src/                        # HF API — Fastify server (TypeScript)
│   ├── routes/                 # API route handlers
│   ├── services/               # Hedera, wallet, dataset service layer
│   ├── core/                   # Core backend client wrappers
│   ├── datasets/               # Dataset anchor orchestration
│   ├── ingest/                 # Generic ingest orchestration
│   ├── auth/                   # API key auth, actor model
│   └── lib/                    # Entitlements, gateway context
├── packages/
│   └── hf-local/               # Local-first SDK (published to npm)
├── frontend/                   # React + Vite UI (separate deployment)
├── Dockerfile
└── docker-compose.yml
```

---

## hf-local SDK

`hf-local` is a local-first SDK for generating deterministic dataset evidence outside of Hash Factory. Raw data never leaves the user's machin. Only derived evidence packages are submitted to HF.

```bash
npm install hf-local
```

Full documentation: [npmjs.com/package/hf-local](https://www.npmjs.com/package/hf-local)

---

## Judge access

This project is submitted to the **Hedera Apex Hackathon 2026 — Open Track**.

To explore the live deployment, request an early access API key by contacting:
**contact@veraanchor.com**

---

## License

- **Hash Factory (this repo):** Source-available. Inspection permitted. Commercial use restricted. See [LICENSE](./LICENSE).
- **hf-local SDK:** MIT with Commons Clause. See [packages/hf-local/LICENSE](./packages/hf-local/LICENSE).