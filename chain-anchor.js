/**
 * Optional MetaMask flow: anchor attestation digest on a deployed HydrationAttestationAnchor.
 * Requires ethers v6 global (see index.html) and HYDRATION_CHAIN_CONFIG.
 */
(function (global) {
  "use strict";

  const ABI = [
    "function anchor(bytes32 sealKey, bytes32 payloadHash) external",
    "function anchors(bytes32) view returns (bytes32, uint256, address)",
  ];

  function getConfig() {
    return global.HYDRATION_CHAIN_CONFIG || {};
  }

  function digestToBytes32Utf8(digestStr) {
    if (!global.ethers) throw new Error("ethers not loaded");
    return global.ethers.keccak256(global.ethers.toUtf8Bytes(String(digestStr)));
  }

  function sealToKey(sealNumber) {
    if (!global.ethers) throw new Error("ethers not loaded");
    return global.ethers.keccak256(global.ethers.toUtf8Bytes(String(sealNumber)));
  }

  /**
   * @param {{ signing: { attestationDigest: string }, certificate?: { sealNumber: string } }} attestation
   */
  async function anchorAttestation(attestation) {
    const cfg = getConfig();
    const addr = cfg.contractAddress;
    if (!addr || typeof addr !== "string" || !addr.startsWith("0x")) {
      throw new Error("Set window.HYDRATION_CHAIN_CONFIG.contractAddress (deploy contract first)");
    }
    if (!global.ethers) {
      throw new Error("ethers not loaded");
    }
    if (!global.ethereum) {
      throw new Error("No injected wallet (MetaMask or compatible)");
    }
    const digest = attestation && attestation.signing && attestation.signing.attestationDigest;
    const seal =
      attestation &&
      attestation.body &&
      attestation.body.certificate &&
      attestation.body.certificate.sealNumber;
    if (!digest || !seal) {
      throw new Error("Attestation missing signing.attestationDigest or seal number");
    }

    const provider = new global.ethers.BrowserProvider(global.ethereum);
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    const want = cfg.chainId != null ? BigInt(cfg.chainId) : null;
    if (want != null && net.chainId !== want) {
      await global.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + want.toString(16) }],
      });
    }

    const contract = new global.ethers.Contract(addr, ABI, signer);
    const sealKey = sealToKey(seal);
    const payloadHash = digestToBytes32Utf8(digest);
    const tx = await contract.anchor(sealKey, payloadHash);
    const receipt = await tx.wait();
    return { hash: receipt.hash, sealKey, payloadHash };
  }

  /**
   * @returns {{ anchored: boolean, payloadHash?: string, anchoredAt?: bigint }}
   */
  async function readAnchorRpc(attestation, rpcUrl) {
    const cfg = getConfig();
    const addr = cfg.contractAddress;
    if (!addr || !rpcUrl) {
      throw new Error("contract address and rpcUrl required");
    }
    if (!global.ethers) throw new Error("ethers not loaded");
    const digest = attestation.signing.attestationDigest;
    const seal = attestation.body && attestation.body.certificate && attestation.body.certificate.sealNumber;
    if (!digest || !seal) throw new Error("Missing seal or digest");

    const provider = new global.ethers.JsonRpcProvider(rpcUrl);
    const contract = new global.ethers.Contract(addr, ABI, provider);
    const sealKey = sealToKey(seal);
    const row = await contract.anchors(sealKey);
    const payloadOnChain = row[0];
    const anchoredAt = row[1];
    const anchoredBy = row[2];
    if (anchoredAt === 0n) {
      return { anchored: false };
    }
    const expected = digestToBytes32Utf8(digest);
    const match = payloadOnChain === expected;
    return {
      anchored: true,
      payloadMatch: match,
      payloadHash: payloadOnChain,
      anchoredAt,
      anchoredBy,
    };
  }

  global.HydrationChainAnchor = {
    anchorAttestation,
    readAnchorRpc,
    sealToKey,
    digestToBytes32Utf8,
  };
})(typeof window !== "undefined" ? window : globalThis);
