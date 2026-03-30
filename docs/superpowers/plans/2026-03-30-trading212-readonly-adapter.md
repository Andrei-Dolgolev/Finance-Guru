# Trading 212 Read-Only Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Trading 212 adapter that exports Finance Guru’s existing CSV snapshots so current workflows can operate unchanged.

**Architecture:** Build a Python Trading 212 client and adapter that normalize API data into a broker-neutral snapshot model, then write legacy CSV artifacts for the existing Fidelity-shaped runtime. Keep runtime consumers stable and limit TypeScript changes to broker metadata only.

**Tech Stack:** Python 3.12, requests, csv, argparse, pytest, TypeScript broker metadata

---

### Task 1: Add failing tests for the Trading 212 snapshot bridge

**Files:**
- Create: `tests/python/test_trading212_sync.py`

- [ ] **Step 1: Write the failing tests**

```python
from pathlib import Path

from src.integrations.trading212 import (
    BrokerPortfolioSnapshot,
    LegacySnapshotWriter,
    SnapshotBalances,
    SnapshotPosition,
    Trading212Config,
    Trading212Client,
    Trading212Environment,
)


def test_trading212_config_selects_live_base_url():
    config = Trading212Config(api_key="key", api_secret="secret", environment=Trading212Environment.LIVE)
    assert "live" in str(config.base_url)


def test_trading212_client_builds_basic_auth_header():
    config = Trading212Config(api_key="key", api_secret="secret", environment=Trading212Environment.DEMO)
    client = Trading212Client(config)
    assert client.session.headers["Authorization"].startswith("Basic ")


def test_legacy_snapshot_writer_emits_expected_files(tmp_path: Path):
    snapshot = BrokerPortfolioSnapshot(
        broker="trading212",
        positions=[
            SnapshotPosition(
                instrument_code="AAPL_US_EQ",
                ticker="AAPL",
                name="Apple",
                quantity=2.5,
                average_cost_basis=150.0,
                current_price=180.0,
                current_value=450.0,
                unrealized_pl=75.0,
                unrealized_pl_pct=20.0,
                daily_pl=5.0,
                daily_pl_pct=1.12,
            )
        ],
        balances=SnapshotBalances(
            cash_available=1000.0,
            cash_reserved=125.0,
            total_value=1575.0,
            invested_value=450.0,
            result=75.0,
        ),
    )

    writer = LegacySnapshotWriter(tmp_path)
    paths = writer.write(snapshot)

    assert paths.positions.exists()
    assert paths.balances.exists()
    assert "Portfolio_Positions_" in paths.positions.name
    assert paths.balances.name == "Balances_for_Account_TRADING212.csv"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: FAIL with import errors because `src.integrations.trading212` does not exist yet.

- [ ] **Step 3: Commit the failing test scaffold only after red is confirmed**

```bash
git add tests/python/test_trading212_sync.py
git commit -m "test: add Trading 212 snapshot bridge coverage"
```

### Task 2: Implement the Python Trading 212 config, client, models, and writer

**Files:**
- Create: `src/integrations/__init__.py`
- Create: `src/integrations/trading212.py`
- Modify: `.env.example`

- [ ] **Step 1: Write the minimal implementation to satisfy the config and writer tests**

```python
class Trading212Environment(str, Enum):
    LIVE = "live"
    DEMO = "demo"


@dataclass(frozen=True)
class Trading212Config:
    api_key: str
    api_secret: str
    environment: Trading212Environment = Trading212Environment.LIVE

    @property
    def base_url(self) -> str:
        return "https://live.trading212.com/api/v0" if self.environment == Trading212Environment.LIVE else "https://demo.trading212.com/api/v0"
```

```python
class Trading212Client:
    def __init__(self, config: Trading212Config) -> None:
        token = base64.b64encode(f"{config.api_key}:{config.api_secret}".encode()).decode()
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Basic {token}"})
```

```python
class LegacySnapshotWriter:
    def write(self, snapshot: BrokerPortfolioSnapshot) -> SnapshotPaths:
        ...
```

- [ ] **Step 2: Add environment placeholders**

```dotenv
TRADING212_API_KEY=your_trading212_api_key_here
TRADING212_API_SECRET=your_trading212_api_secret_here
TRADING212_ENV=demo
```

- [ ] **Step 3: Run tests to verify green**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: PASS for the initial config and writer tests.

- [ ] **Step 4: Commit the minimal implementation**

```bash
git add src/integrations/__init__.py src/integrations/trading212.py .env.example
git commit -m "feat: add Trading 212 snapshot bridge primitives"
```

### Task 3: Add adapter behavior tests and implement API normalization

**Files:**
- Modify: `tests/python/test_trading212_sync.py`
- Modify: `src/integrations/trading212.py`

- [ ] **Step 1: Add failing normalization tests**

```python
def test_adapter_maps_account_summary_and_positions():
    client = FakeTrading212Client(...)
    snapshot = Trading212Adapter(client).fetch_snapshot()
    assert snapshot.balances.cash_available == 1000.0
    assert snapshot.balances.cash_reserved == 125.0
    assert snapshot.positions[0].ticker == "AAPL"
    assert snapshot.positions[0].quantity == 2.5
```

```python
def test_adapter_falls_back_when_instrument_metadata_missing():
    client = FakeTrading212Client(...)
    snapshot = Trading212Adapter(client).fetch_snapshot()
    assert snapshot.positions[0].ticker == "UNKNOWNUS"
```

- [ ] **Step 2: Run tests to verify red**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: FAIL because `Trading212Adapter` and fallback mapping behavior are not implemented yet.

- [ ] **Step 3: Implement adapter normalization**

```python
class Trading212Adapter:
    def fetch_snapshot(self) -> BrokerPortfolioSnapshot:
        summary = self.client.get_account_summary()
        metadata = self.client.get_instruments()
        positions = self.client.get_positions()
        ...
```

- [ ] **Step 4: Run tests to verify green**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: PASS with normalized balances and positions.

- [ ] **Step 5: Commit the adapter behavior**

```bash
git add tests/python/test_trading212_sync.py src/integrations/trading212.py
git commit -m "feat: normalize Trading 212 portfolio snapshots"
```

### Task 4: Add the read-only CLI and broker metadata updates

**Files:**
- Modify: `tests/python/test_trading212_sync.py`
- Create: `src/utils/trading212_sync_cli.py`
- Modify: `scripts/onboarding/modules/broker-types.ts`

- [ ] **Step 1: Add failing CLI and metadata tests**

```python
def test_sync_cli_writes_snapshots(tmp_path, monkeypatch):
    monkeypatch.setenv("FIN_GURU_PORTFOLIO_DIR", str(tmp_path))
    exit_code = main(["--env", "demo"])
    assert exit_code == 0
```

TypeScript expectation:

```ts
expect(SUPPORTED_BROKERS.trading212.name).toBe("Trading 212");
```

- [ ] **Step 2: Run tests to verify red**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: FAIL because CLI entry point does not exist yet.

- [ ] **Step 3: Implement the CLI and broker metadata**

```python
def main(argv: list[str] | None = None) -> int:
    config = Trading212Config.from_env(...)
    snapshot = Trading212Adapter(Trading212Client(config)).fetch_snapshot()
    LegacySnapshotWriter(output_dir).write(snapshot)
    return 0
```

```ts
export type BrokerType = ... | 'trading212';
```

- [ ] **Step 4: Run targeted verification**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: PASS

Run: `uv run python src/utils/trading212_sync_cli.py --help`
Expected: usage output with Trading 212 options

- [ ] **Step 5: Commit the CLI and metadata updates**

```bash
git add src/utils/trading212_sync_cli.py scripts/onboarding/modules/broker-types.ts tests/python/test_trading212_sync.py
git commit -m "feat: add Trading 212 read-only sync command"
```

### Task 5: Final verification for the feature slice

**Files:**
- Verify only

- [ ] **Step 1: Run the feature test suite**

Run: `uv run pytest tests/python/test_trading212_sync.py -v`
Expected: PASS

- [ ] **Step 2: Run adjacent regression checks**

Run: `uv run pytest tests/python/test_total_return.py tests/python/test_hedge_sizer.py tests/python/test_config.py -v`
Expected: PASS

- [ ] **Step 3: Run Python lint on touched files**

Run: `uv run ruff check src/integrations/trading212.py src/utils/trading212_sync_cli.py tests/python/test_trading212_sync.py`
Expected: All checks passed

- [ ] **Step 4: Commit the final verification if any cleanup was needed**

```bash
git add -A
git commit -m "chore: finish Trading 212 read-only adapter"
```

## Self-Review

Spec coverage:

- API config/auth: Tasks 1-2
- normalization: Task 3
- compatibility export: Tasks 1-3
- CLI execution path: Task 4
- verification: Task 5

No placeholders remain intentionally. The phase is limited to read-only sync plus compatibility export; direct runtime refactor and order placement are excluded by design.
