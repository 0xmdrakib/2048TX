# 2048 TX

2048 TX is a Base mini app and web game that turns 2048 gameplay into optional onchain activity.

**Live app:** https://2048tx.vercel.app

---

## Overview

2048 TX combines classic 2048 gameplay with wallet-connected score saving and optional pay-per-move transactions on Base.

Players can play normally in **Classic Mode**, save scores onchain through the `Score2048` contract, or switch to **Pay-per-move Mode**, where each valid move confirms a tiny randomized USDC transfer. The goal is to make onchain activity feel like part of a lightweight game loop instead of a separate blockchain task.

## Features

- Classic 2048 gameplay with keyboard, button, and swipe controls
- Board size switcher for **3x3**, **4x4**, and **5x5** games
- **Classic Mode** for normal play with optional score saving
- **Pay-per-move Mode** for confirming a small USDC transfer on every valid move
- Randomized pay-per-move amounts from **0.000001 USDC** to **0.000005 USDC**
- Optional onchain score saving through the `Score2048` smart contract
- Weekly **Top 100** leaderboard backed by onchain score submissions and Upstash Redis
- Wallet support for Base App, Farcaster mini app wallet provider, and injected browser wallets
- Theme picker with **Classic**, **Neon**, **Pastel**, and **AMOLED** themes
- Farcaster share flow with browser share and clipboard fallbacks
- Mobile WebView viewport handling for smoother in-app gameplay
- Optional CDP Paymaster proxy support for sponsored score-save transactions
- Optional Base Builder Code / ERC-8021 calldata attribution

## Supported network

- Base Mainnet

## Game modes

### Classic Mode

Classic Mode lets players play 2048 normally. Scores increase when tiles merge, and players can optionally connect a wallet to save their current score onchain.

### Pay-per-move Mode

Pay-per-move Mode requires a wallet transaction for every valid move. Each move sends a tiny randomized native USDC transfer on Base to the configured recipient address.

This mode is designed to create real user-driven transactions while keeping the gameplay loop simple and transparent.

## Onchain score saving

Scores are submitted to the `Score2048` contract in `contracts/Score2048.sol`.

The contract tracks:

- each player’s best score
- each player’s latest submitted score
- each player’s total submission count

Every score submission changes contract state through the submission counter. The best score only updates when the submitted score is higher than the player’s previous best.

If a paymaster proxy is configured and the connected wallet supports sponsored calls, the app attempts to save scores through a sponsored `wallet_sendCalls` flow. If sponsorship is unavailable, it falls back to a normal wallet transaction.

## Leaderboard

The leaderboard shows the current weekly **Top 100** players.

New score transactions are ingested through the leaderboard API after a score-save transaction is confirmed. The server also performs throttled block syncs to catch `ScoreSubmitted` events that may have been submitted outside the frontend.

Weekly rollover endpoints keep completed-week snapshots in Redis so each week can be finalized separately.

## Tech stack

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- viem
- Base Account SDK
- Farcaster Mini App SDK
- Upstash Redis
- Solidity

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root. Then fill the required values from [.env.example](./.env.example).

For local testing, the game UI can run with minimal configuration. Onchain score saving, pay-per-move transfers, leaderboard sync, mini app verification, and paymaster sponsorship require the related environment variables.

### 3. Run the development server

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

### 4. Build for production

```bash
npm run build
npm run start
```

## Smart contract

The score contract is available in `contracts/Score2048.sol`.

It exposes:

- `best(address)`
- `lastScore(address)`
- `submissions(address)`
- `submitScore(uint32 score)`

It also emits a `ScoreSubmitted` event that is used for leaderboard indexing.

## License

This project is licensed under the [MIT License](./LICENSE).
