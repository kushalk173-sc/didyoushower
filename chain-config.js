/**
 * After deploying contracts/HydrationAttestationAnchor.sol, set contractAddress here.
 * Deploy: npm run deploy:sepolia (see scripts/deploy-sepolia.mjs) or Remix — CONTRACTS.md.
 *
 * readOnlyRpcUrl — optional HTTPS JSON-RPC for verify.html "Check on-chain anchor" (no secrets).
 * Use your own Alchemy/Infura URL in production if public endpoints rate-limit you.
 */
window.HYDRATION_CHAIN_CONFIG = {
  /** Set to the address printed by `npm run deploy:sepolia` */
  contractAddress: null,
  chainId: 11155111n,
  networkLabel: "Sepolia (testnet)",
  readOnlyRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
};
