// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HydrationAttestationAnchor
 * @notice Stores a public anchor: keccak256(sealNumber) -> keccak256(attestationDigest string).
 *         This is NOT a government credential, qualified signature, or legal attestation —
 *         only an immutable registry entry anyone can read on-chain.
 * @dev Deploy via Remix, Foundry, or Hardhat; point the web app at the deployed address.
 */
contract HydrationAttestationAnchor {
    struct Anchor {
        bytes32 payloadHash;
        uint256 anchoredAt;
        address anchoredBy;
    }

    mapping(bytes32 => Anchor) public anchors;

    event AttestationAnchored(
        bytes32 indexed sealKey,
        bytes32 indexed payloadHash,
        address indexed anchoredBy,
        uint256 anchoredAt
    );

    error AlreadyAnchored();
    error ZeroSealKey();
    error ZeroPayload();

    /**
     * @param sealKey keccak256(abi.encodePacked(sealNumber)) computed off-chain from UTF-8 seal string
     * @param payloadHash keccak256(abi.encodePacked(attestationDigest)) where attestationDigest is base64url from JSON
     */
    function anchor(bytes32 sealKey, bytes32 payloadHash) external {
        if (sealKey == bytes32(0)) revert ZeroSealKey();
        if (payloadHash == bytes32(0)) revert ZeroPayload();
        if (anchors[sealKey].anchoredAt != 0) revert AlreadyAnchored();

        anchors[sealKey] = Anchor({
            payloadHash: payloadHash,
            anchoredAt: block.timestamp,
            anchoredBy: msg.sender
        });

        emit AttestationAnchored(sealKey, payloadHash, msg.sender, block.timestamp);
    }

    function isAnchored(bytes32 sealKey) external view returns (bool) {
        return anchors[sealKey].anchoredAt != 0;
    }
}
