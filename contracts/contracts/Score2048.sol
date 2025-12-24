// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * 2048TX Score contract
 *
 * - Best score is tracked onchain only.
 * - Users can submit any score at any time.
 * - Every submission writes state (submissions counter), so low scores are not
 *   treated as a no-op by wallets.
 * - Best updates only if the submitted score is higher.
 */
contract Score2048 {
    mapping(address => uint32) public best;
    mapping(address => uint32) public lastScore;
    mapping(address => uint64) public submissions;

    event ScoreSubmitted(
        address indexed player,
        uint32 score,
        uint32 bestScore,
        uint64 submissionIndex
    );

    function submitScore(uint32 score) external {
        // Always change state so this tx isn't a no-op.
        lastScore[msg.sender] = score;
        uint64 idx = submissions[msg.sender] + 1;
        submissions[msg.sender] = idx;

        uint32 b = best[msg.sender];
        if (score > b) {
            b = score;
            best[msg.sender] = score;
        }

        emit ScoreSubmitted(msg.sender, score, b, idx);
    }
}
