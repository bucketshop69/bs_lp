# Liquidity Provider (LP) Feature Development Plan

## Overview
This document outlines the development plan for implementing the Liquidity Provider feature in our Telegram bot, allowing users to provide liquidity to Raydium CLMM pools.

## Phase 1: Data Fetching & Basic Listing Logic

### API Integration
- [x] Select and integrate Raydium CLMM pools API
- [x] Implement data fetching functions
- [x] Create standardized PoolInfo interface:
```typescript
interface PoolInfo {
    pairName: string;
    poolId: string;
    tokenAMint: string;
    tokenBMint: string;
    volume24h: number;
    fees24h: number;
    tvl: number;
    indicativeApr?: number;
}
```

### Filtering/Sorting Logic
- [x] Implement initial filtering criteria:
  - Minimum TVL threshold
  - Minimum 24h volume threshold
- [x] Implement default sorting options:
  - By 24h volume
  - By fees generated
  - By indicative APR

### /lps Command Handler
- [ ] Create `src/bot/commands/lps.ts`
- [ ] Implement `handleLpsCommand(bot, msg)`:
  - Fetch pool data
  - Store pool list with pagination state
- [ ] Implement pagination (5 pools per page)
- [ ] Format pool display:
```
TokenA/TokenB
Volume: $X | Fees: $Y | APR: Z%
```
- [ ] Add navigation buttons:
  - "◀️ Prev"
  - "Page X/Y"
  - "Next ▶️"
  - "Select 1", "Select 2", etc.

## Phase 2: Pool Selection & Liquidity Type Choice

### Callback Query Handler
- [ ] Implement pool selection handler
- [ ] Display detailed pool information
- [ ] Add liquidity type options:
  - "Single-Sided LP"
  - "Dual-Sided LP"
  - "Back to List"

## Phase 3: Liquidity Input Collection

### Single-Sided LP Flow
- [ ] Implement token selection prompt
- [ ] Add amount input collection
- [ ] Add price range input:
  - Minimum price
  - Maximum price
- [ ] Implement state management for user progress

### Dual-Sided LP Flow (Future)
- [ ] Design token amount collection
- [ ] Implement price range input
- [ ] Add ratio calculation logic

## Phase 4: Transaction Execution

### Transaction Logic
- [ ] Implement private key retrieval and decryption
- [ ] Build Raydium SDK transaction
- [ ] Add transaction signing
- [ ] Implement transaction sending
- [ ] Add success/failure notifications

## Technical Considerations

### State Management
```typescript
interface UserLpState {
    poolId: string;
    selectedToken: 'A' | 'B';
    amount: number;
    minPrice: number;
    maxPrice: number;
    step: 'token' | 'amount' | 'minPrice' | 'maxPrice' | 'confirm';
}
```

### Error Handling
- [x] API failure handling
- [ ] Invalid input validation
- [ ] Transaction failure recovery
- [ ] User timeout handling

### Security
- [ ] Private key encryption
- [ ] Input sanitization
- [ ] Rate limiting
- [ ] Transaction validation

## Testing Plan
1. Unit tests for data fetching
2. Integration tests for API calls
3. End-to-end tests for complete LP flow
4. Security testing for private key handling

## Future Enhancements
1. Dual-sided LP implementation
2. Advanced pool filtering
3. Historical performance metrics
4. Position management features 