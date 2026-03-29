pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

/// Proves knowledge of (nonce, ts) such that Poseidon(nonce, ts, verdict) == commitment
/// with verdict forced to 1 (dry). Public inputs: commitment, verdict.
template DryCommitment() {
    signal input nonce;
    signal input ts;
    signal input verdict;
    signal input commitment;

    component p = Poseidon(3);
    p.inputs[0] <== nonce;
    p.inputs[1] <== ts;
    p.inputs[2] <== verdict;

    commitment === p.out;

    verdict * (verdict - 1) === 0;
    verdict === 1;
}

component main {public [commitment, verdict]} = DryCommitment();
