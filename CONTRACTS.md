# Hydration attestation anchor (EVM)

This is **not** government-grade identity, a qualified electronic signature, or a legal credential. It is a **public hash registry**: anyone can see that a given seal’s attestation digest was anchored by some wallet at some time.

## What the contract does

`contracts/HydrationAttestationAnchor.sol` stores:

- `keccak256(UTF-8 seal number)` → `keccak256(UTF-8 attestationDigest string)` plus timestamp and sender.

The web app uses the same hashing as `HydrationChainAnchor` in `chain-anchor.js`.

## Deploy (npm script — recommended)

Requires [Node.js](https://nodejs.org/) and a Sepolia wallet with a little test ETH.

1. Get **Sepolia ETH** from a public faucet (search “Sepolia faucet”).
2. From the repo root:

```powershell
$env:SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
$env:PRIVATE_KEY="0xYOUR_DEPLOYER_PRIVATE_KEY"
npm install
npm run deploy:sepolia
```

3. Copy the printed address into `chain-config.js` as `contractAddress`.
4. Dry-run compile only: `npm run compile:contract`

Never commit `PRIVATE_KEY` or `.env` with real keys (`.env` is gitignored).

## Deploy (Remix)

1. Open [Remix](https://remix.ethereum.org).
2. Create file `HydrationAttestationAnchor.sol` and paste the contract from this repo.
3. Compile with Solidity 0.8.20+.
4. Deploy on **Sepolia** (test ETH from a public faucet).
5. Copy the deployed address into `chain-config.js` as `contractAddress`.

## Configure the app

Edit `chain-config.js`:

- `contractAddress` — deployed contract
- `chainId` — `11155111n` for Sepolia

Serve the site over **HTTPS or localhost** (MetaMask requires a secure context for some flows).

## Optional: Foundry

```bash
forge create contracts/HydrationAttestationAnchor.sol:HydrationAttestationAnchor --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY
```

## “Government-level” authenticity

Real government or regulated use requires a **qualified trust service**, audited PKI, identity proofing, and legal process — not a browser demo. The anchor only proves **this digest was registered on-chain** under **this seal key**, not who the person is or that a regulator endorsed it.
