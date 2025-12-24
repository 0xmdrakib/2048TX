// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Score2048 {
    mapping(address => uint32) public best;

    event ScoreSubmitted(address indexed player, uint32 score, uint32 newBest);

    function submitScore(uint32 score) external {
        uint32 current = best[msg.sender];
        if (score > current) {
            best[msg.sender] = score;
            emit ScoreSubmitted(msg.sender, score, score);
        } else {
            emit ScoreSubmitted(msg.sender, score, current);
        }
    }
}
