# Trading 212 Read-Only Adapter Design

## Goal

Add Trading 212 read-only support without refactoring the existing Fidelity-shaped Finance Guru runtime. The new integration should fetch live Trading 212 portfolio data, normalize it into a small internal snapshot model, and emit legacy CSV snapshots so existing Finance Guru workflows can continue to operate unchanged.

## Scope

In scope:

- Read-only Trading 212 API integration
- Environment-based configuration for Trading 212 credentials and environment selection
- Instrument identifier to ticker normalization
- Legacy snapshot export for existing Finance Guru CSV consumers
- Minimal broker metadata updates in onboarding code
- Automated tests for the new adapter and writer

Out of scope:

- Order placement
- Demo/live trading workflow automation
- Refactoring current Fidelity-based spreadsheet workflows
- Replacing existing CSV consumers with direct API reads

## Current Constraints

The repo is still Fidelity-first in the runtime paths that matter:

- [portfolio_loader.py](/home/andrey/Finance-Guru/.worktrees/trading212-readonly-adapter/src/ui/services/portfolio_loader.py) reads `Portfolio_Positions_*.csv`
- [hedge_sizer.py](/home/andrey/Finance-Guru/.worktrees/trading212-readonly-adapter/src/analysis/hedge_sizer.py) reads `Balances_for_Account_*.csv`
- [total_return_cli.py](/home/andrey/Finance-Guru/.worktrees/trading212-readonly-adapter/src/analysis/total_return_cli.py) reads position quantities from `Portfolio_Positions_*.csv`
- Workflow docs and skills assume Fidelity-style file naming and balance semantics

This makes a broker-neutral runtime refactor expensive. The adapter therefore needs to bridge into the current CSV contract instead of trying to replace it in phase 1.

## Architecture

The implementation will use a hybrid bridge:

1. `Trading212Client`
   Talks to the Trading 212 API with Basic auth, timeout handling, and explicit base URL selection.

2. `Trading212Adapter`
   Fetches account summary, positions, and instrument metadata, then maps them into broker-neutral snapshot objects.

3. `LegacySnapshotWriter`
   Converts the normalized snapshot into the current Finance Guru CSV shapes:
   - `Portfolio_Positions_<date>.csv`
   - `Balances_for_Account_TRADING212.csv`

4. `trading212_sync_cli`
   Read-only CLI entry point that refreshes the legacy snapshots on demand.

Existing consumers stay unchanged in phase 1.

## Internal Data Model

The adapter should not pretend Trading 212 is Fidelity internally. It should use explicit normalized objects:

- `SnapshotPosition`
  - `instrument_code`
  - `ticker`
  - `name`
  - `quantity`
  - `average_cost_basis`
  - `current_price`
  - `current_value`
  - `unrealized_pl`
  - `unrealized_pl_pct`
  - `daily_pl`
  - `daily_pl_pct`

- `SnapshotBalances`
  - `cash_available`
  - `cash_reserved`
  - `total_value`
  - `invested_value`
  - `result`

- `BrokerPortfolioSnapshot`
  - `broker`
  - `captured_at`
  - `positions`
  - `balances`

## Trading 212 Mapping Rules

Trading 212 values need explicit mapping into Finance Guru’s legacy CSV semantics:

- `cash.availableToTrade` -> legacy settled cash / SPAXX-equivalent balance
- `cash.reservedForOrders` -> legacy pending activity
- margin debt -> `0.00` in phase 1
- `investments.currentValue` -> invested market value
- `investments.result` -> unrealized result
- `quantity` stays fractional when provided
- `ticker` comes from instrument metadata, not by splitting the raw instrument code

If an instrument lookup is missing, the adapter should fall back to a sanitized best-effort symbol and flag the issue in CLI output.

## Legacy CSV Contract

The writer only needs to satisfy existing consumers, not replicate every Fidelity export quirk.

Positions CSV must contain at least:

- `Symbol`
- `Quantity`
- `Last Price`
- `Current Value`
- `Today's Gain/Loss Dollar`
- `Today's Gain/Loss Percent`
- `Total Gain/Loss Dollar`
- `Total Gain/Loss Percent`
- `Average Cost Basis`
- `Type`

Balances CSV must include key rows already read by current Finance Guru logic:

- `Total account value`
- `Settled cash`
- `Net debit`
- `Account equity percentage`
- `Margin interest accrued this month`

For Trading 212 phase 1:

- `Net debit` is always `0.00`
- `Account equity percentage` is always `100%`
- `Margin interest accrued this month` is always `0.00`

These are explicit compatibility defaults, not broker facts.

## Configuration

New environment variables:

- `TRADING212_API_KEY`
- `TRADING212_API_SECRET`
- `TRADING212_ENV=live|demo`
- `TRADING212_ACCOUNT_ID` optional, for future multi-account routing

The CLI should fail fast with a clear error if credentials are missing.

## Error Handling

The integration should fail safely:

- Missing credentials: abort with actionable message
- API timeout / non-200 response: abort without writing partial snapshots
- Missing instrument metadata: continue with fallback ticker and warning
- Empty positions with non-zero account value: warn and still write balances snapshot
- Writer errors: leave existing snapshots untouched where possible

## Testing Strategy

Unit tests should cover:

- auth header generation and environment URL selection
- account summary normalization
- position normalization using instrument metadata
- legacy CSV output columns and balance rows
- snapshot directory creation
- fallback behavior when metadata is missing

Regression safety:

- existing CSV consumers should keep working against the generated files
- no direct changes to current portfolio loader logic in phase 1 unless tests force a compatibility adjustment

## Future Extension Path

This design leaves clean seams for later work:

- add transaction/dividend export writer
- add optional direct-runtime broker loaders
- add broker capability flags
- add order placement in a separate write-enabled path

## Baseline Notes

The isolated worktree baseline is not fully clean before this feature:

- Python suite has unrelated pre-existing failures in onboarding tests
- `bun` is not installed in this environment, so Bun-based TypeScript tests are not currently runnable here

This feature should therefore verify its own targeted tests and avoid claiming the repo was globally green beforehand.
