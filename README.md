# Live Chain Monitors

Real-time "smart money" dashboards for six blockchains: **Sui, NEAR, Hedera,
Starknet, Cronos and elysp (a HyperEVM L2)**. Each one watches a list of wallets
or pools continuously, groups their swaps **by token**, ranks tokens by how much
tracked money just flowed in, and sends a Telegram alert when several tracked
wallets converge on the same token.

> **Showcase repository.** This repo documents the design and includes a sample
> module. The full source is kept private. © 2026 AJO1234 — all rights reserved.

## Wallet-first vs pool-first

Before building any monitor I measured one question on the live chain: *can a
wallet's own transaction history reconstruct both legs of a swap?* The answer
decides the design, and it differs between chains.

| Chain | Design | Why |
|---|---|---|
| Sui | wallet-first | Every tx carries signed per-coin `balanceChanges`, so one RPC call per wallet is enough and it works on any DEX |
| Starknet | wallet-first | Both legs can be rebuilt from transfer events (with care for two Cairo event layouts and felt padding) |
| Hedera | wallet-first | Works, but a swap is a transaction *group*: the parent has no token transfers, and wallets have three address forms |
| NEAR | pool-first | One major DEX keeps the token leg in an internal balance, so a 50/50 swap nets to zero from the wallet's side |
| Cronos | pool-first | Native-coin swaps emit no log. A test of 120 wallet txs found 0 swap-shaped ones |
| elysp | swap-event | Keys on the Uniswap v4 `Swap` event; liquidity is computed exactly from L and √P |

## Rules that stop the classifier from lying

Taking Sui as the example:

1. **Gas floor.** Every tx has a negative gas leg. Without a minimum, an airdrop
   (`+TOKEN`, `−gas`) reads as a buy.
2. **Opposite signs.** LP deposits (`−TOKEN, −QUOTE`) and withdrawals look like
   trades unless the two legs must have opposite signs.
3. **Largest quote leg, not the first.** Otherwise a $4,000 USDC buy gets valued at
   the $0.015 of gas that paid for it.
4. **Drained pools.** A pool drained from $16,638 to $0.13 was quoted at a
   **$31B FDV**. A price-quality check flags these: price is struck through, but
   liquidity and the tracked inflow (real money spent) stay trusted.

Each monitor has a `selftest` covering these cases.

## Shared engineering

- **One rate limiter per upstream host**, shared by every caller in the process.
  Three callers that were each polite on their own added up to 429s, and those
  showed in the UI as tokens with "no name", not as errors.
  See [`samples/ratelimit.js`](samples/ratelimit.js).
- **Deadline-paced poller.** The whole watchlist is covered once per interval
  whatever its size. A fixed per-wallet gap drifts because it ignores call
  latency; pacing to a deadline measured 30,007 ms against a 30,000 ms target.
- **Honest floors.** Wallets that trade faster than one page per visit are marked
  `busy`, so their totals show as a minimum, not a full count.

## Stack

Node.js, Express, chain RPCs, GeckoTerminal/DexScreener market data, the Telegram
Bot API, nginx, PM2, and a vanilla JS dashboard.
