# 2048 TX — Base + Farcaster Mini App

A 2048 mini app with:
- **Classic mode** (default)
- **Pay-per-move mode** (each move requires a Base Pay USDC payment, randomized **0.000001–0.000005**)
- **Onchain-only best score** (score is counted **only** after the user saves onchain)

## Why “onchain-only best” matters

You asked for this strict rule:
> If user doesn't do a tx for save their score then their score won't count on best score.

So this app **does not store best locally**. It reads/writes best from the score contract only.

## Quickstart

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`

## Required env vars

- `NEXT_PUBLIC_APP_URL` — your deployed domain (used in the manifest)
- `NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS` — deploy the score contract and paste it here
- `NEXT_PUBLIC_PAY_RECIPIENT` — where micro payments go (your address or ENS)
- `NEXT_PUBLIC_CHAIN_ID` — 8453 (Base) or 84532 (Base Sepolia)
- `NEXT_PUBLIC_TESTNET` — `true` for Base Pay testnet mode

## Score contract (Solidity)

This repo includes a simple Hardhat project in `./contracts`:
- `submitScore(uint32 score)` writes your best score
- `best(address)` reads your best score

### Deploy (Hardhat)

```bash
cd contracts
npm install
cp .env.example .env
# put PRIVATE_KEY + RPC url
npx hardhat compile
npx hardhat run scripts/deploy.ts --network base
```

Then copy the deployed address into `NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS`.

## Manifest

The app serves a manifest at:

`/.well-known/farcaster.json`

You must:
1. generate an **accountAssociation** signature (Farcaster Developer Tools)
2. replace the placeholder values in `app/.well-known/farcaster.json/route.ts`

## Notes

- In Farcaster clients, the app calls `sdk.actions.ready()` to hide the splash screen.
- For wallet calls, it prefers `sdk.wallet.getEthereumProvider()` and falls back to `window.ethereum`.

## Automation idea

Add a simple CI check that fetches:
- `/.well-known/farcaster.json` (must be 200)
- `/api/health` (must show both `hasPayRecipient` + `hasScoreContract`)
so broken manifests don’t ship.
