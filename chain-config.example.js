/**
 * Copy to chain-config.js and fill in after you deploy HydrationAttestationAnchor.sol.
 * chain-config.js is intended to stay local (do not commit secrets).
 *
 * Typical testnet: Ethereum Sepolia chainId 11155111.
 */
window.HYDRATION_CHAIN_CONFIG = {
  /** Set after deployment, e.g. "0x..." */
  contractAddress: null,
  /** bigint — Sepolia = 11155111n */
  chainId: 11155111n,
  /** Optional label for UI */
  networkLabel: "Sepolia (testnet)",
};
