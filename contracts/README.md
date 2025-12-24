# Score2048 contract

Simple onchain best score storage.

## Deploy

```bash
npm install
cp .env.example .env
# fill PRIVATE_KEY and RPC URL(s)
npx hardhat compile
npx hardhat run scripts/deploy.ts --network baseSepolia
```

Copy the address into the app env:
`NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS=0x...`
