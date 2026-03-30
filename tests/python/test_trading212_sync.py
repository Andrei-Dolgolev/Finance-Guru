"""Tests for the Trading 212 read-only snapshot bridge."""

from __future__ import annotations

import base64
import csv
from pathlib import Path

from src.integrations.trading212 import (
    BrokerPortfolioSnapshot,
    LegacySnapshotWriter,
    SnapshotBalances,
    SnapshotPosition,
    Trading212Adapter,
    Trading212Client,
    Trading212Config,
    Trading212Environment,
)


def test_trading212_config_selects_live_base_url() -> None:
    """Live config should use the live Trading 212 host."""
    config = Trading212Config(
        api_key="key",
        api_secret="secret",
        environment=Trading212Environment.LIVE,
    )

    assert config.base_url == "https://live.trading212.com"


def test_trading212_client_builds_basic_auth_header() -> None:
    """Client should use Basic auth with key:secret credentials."""
    config = Trading212Config(
        api_key="key",
        api_secret="secret",
        environment=Trading212Environment.DEMO,
    )

    client = Trading212Client(config)

    token = base64.b64encode(b"key:secret").decode()
    assert client.session.headers["Authorization"] == f"Basic {token}"


def test_legacy_snapshot_writer_emits_expected_files(tmp_path: Path) -> None:
    """Writer should export the current Finance Guru CSV contract."""
    snapshot = BrokerPortfolioSnapshot(
        broker="trading212",
        positions=[
            SnapshotPosition(
                instrument_code="AAPL_US_EQ",
                ticker="AAPL",
                name="Apple Inc",
                quantity=2.5,
                average_cost_basis=150.0,
                current_price=180.0,
                current_value=450.0,
                unrealized_pl=75.0,
                unrealized_pl_pct=20.0,
                daily_pl=0.0,
                daily_pl_pct=0.0,
            )
        ],
        balances=SnapshotBalances(
            cash_available=1000.0,
            cash_reserved=125.0,
            total_value=1575.0,
            invested_value=450.0,
            unrealized_pl=75.0,
        ),
    )

    writer = LegacySnapshotWriter(tmp_path)
    paths = writer.write(snapshot)

    assert paths.positions.exists()
    assert paths.balances.exists()
    assert "Portfolio_Positions_" in paths.positions.name
    assert paths.balances.name == "Balances_for_Account_TRADING212.csv"

    with paths.positions.open(newline="") as positions_file:
        rows = list(csv.DictReader(positions_file))

    assert rows[0]["Symbol"] == "AAPL"
    assert rows[0]["Quantity"] == "2.5"
    assert rows[0]["Average Cost Basis"] == "150.00"
    assert rows[0]["Type"] == "Cash"

    balances_text = paths.balances.read_text()
    assert "Total account value,1575.00" in balances_text
    assert "Settled cash,1000.00" in balances_text
    assert "Net debit,0.00" in balances_text


class _FakeTrading212Client:
    """Stub client for adapter tests."""

    def __init__(self, summary: dict, positions: list[dict]) -> None:
        self._summary = summary
        self._positions = positions

    def get_account_summary(self) -> dict:
        return self._summary

    def get_positions(self) -> list[dict]:
        return self._positions


def test_adapter_maps_account_summary_and_positions() -> None:
    """Adapter should normalize summary and position payloads."""
    client = _FakeTrading212Client(
        summary={
            "cash": {"availableToTrade": 1000.0, "reservedForOrders": 125.0},
            "investments": {
                "currentValue": 450.0,
                "unrealizedProfitLoss": 75.0,
            },
            "totalValue": 1575.0,
        },
        positions=[
            {
                "averagePricePaid": 150.0,
                "currentPrice": 180.0,
                "quantity": 2.5,
                "instrument": {
                    "ticker": "AAPL_US_EQ",
                    "name": "Apple Inc",
                },
                "walletImpact": {
                    "currentValue": 450.0,
                    "totalCost": 375.0,
                    "unrealizedProfitLoss": 75.0,
                },
            }
        ],
    )

    snapshot = Trading212Adapter(client).fetch_snapshot()

    assert snapshot.balances.cash_available == 1000.0
    assert snapshot.balances.cash_reserved == 125.0
    assert snapshot.balances.total_value == 1575.0
    assert snapshot.positions[0].ticker == "AAPL"
    assert snapshot.positions[0].quantity == 2.5
    assert snapshot.positions[0].unrealized_pl_pct == 20.0


def test_adapter_falls_back_to_sanitized_identifier_without_instrument_name() -> None:
    """Adapter should still emit a usable ticker when instrument metadata is thin."""
    client = _FakeTrading212Client(
        summary={
            "cash": {"availableToTrade": 50.0, "reservedForOrders": 0.0},
            "investments": {
                "currentValue": 25.0,
                "unrealizedProfitLoss": 5.0,
            },
            "totalValue": 75.0,
        },
        positions=[
            {
                "averagePricePaid": 20.0,
                "currentPrice": 25.0,
                "quantity": 1.0,
                "instrument": {"ticker": "UNKNOWN_US_EQ"},
                "walletImpact": {
                    "currentValue": 25.0,
                    "totalCost": 20.0,
                    "unrealizedProfitLoss": 5.0,
                },
            }
        ],
    )

    snapshot = Trading212Adapter(client).fetch_snapshot()

    assert snapshot.positions[0].ticker == "UNKNOWN"
    assert snapshot.positions[0].name == "UNKNOWN_US_EQ"


def test_sync_cli_writes_snapshots(tmp_path: Path, monkeypatch) -> None:
    """CLI should write legacy snapshots using env-based credentials."""
    from src.utils import trading212_sync_cli

    snapshot = BrokerPortfolioSnapshot(
        broker="trading212",
        positions=[
            SnapshotPosition(
                instrument_code="MSFT_US_EQ",
                ticker="MSFT",
                name="Microsoft",
                quantity=1.0,
                average_cost_basis=300.0,
                current_price=320.0,
                current_value=320.0,
                unrealized_pl=20.0,
                unrealized_pl_pct=6.67,
                daily_pl=0.0,
                daily_pl_pct=0.0,
            )
        ],
        balances=SnapshotBalances(
            cash_available=50.0,
            cash_reserved=0.0,
            total_value=370.0,
            invested_value=320.0,
            unrealized_pl=20.0,
        ),
    )

    class _FakeClient:
        def __init__(self, config) -> None:
            self.config = config

    class _FakeAdapter:
        def __init__(self, client) -> None:
            self.client = client

        def fetch_snapshot(self) -> BrokerPortfolioSnapshot:
            return snapshot

    monkeypatch.setenv("TRADING212_API_KEY", "key")
    monkeypatch.setenv("TRADING212_API_SECRET", "secret")
    monkeypatch.setattr(trading212_sync_cli, "Trading212Client", _FakeClient)
    monkeypatch.setattr(trading212_sync_cli, "Trading212Adapter", _FakeAdapter)

    exit_code = trading212_sync_cli.main(
        ["--env", "demo", "--output-dir", str(tmp_path)]
    )

    assert exit_code == 0
    assert any(path.name.startswith("Portfolio_Positions_") for path in tmp_path.iterdir())
    assert (tmp_path / "Balances_for_Account_TRADING212.csv").exists()


def test_sync_cli_loads_repo_root_env_file(tmp_path: Path, monkeypatch) -> None:
    """CLI should load Trading 212 config from the repo-root .env file."""
    from src.utils import trading212_sync_cli

    snapshot = BrokerPortfolioSnapshot(
        broker="trading212",
        positions=[
            SnapshotPosition(
                instrument_code="NVDA_US_EQ",
                ticker="NVDA",
                name="NVIDIA",
                quantity=1.0,
                average_cost_basis=100.0,
                current_price=120.0,
                current_value=120.0,
                unrealized_pl=20.0,
                unrealized_pl_pct=20.0,
                daily_pl=0.0,
                daily_pl_pct=0.0,
            )
        ],
        balances=SnapshotBalances(
            cash_available=30.0,
            cash_reserved=0.0,
            total_value=150.0,
            invested_value=120.0,
            unrealized_pl=20.0,
        ),
    )

    env_output_dir = tmp_path / "from-env"
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "TRADING212_API_KEY=dotenv-key",
                "TRADING212_API_SECRET=dotenv-secret",
                "TRADING212_ENV=demo",
                f"FIN_GURU_PORTFOLIO_DIR={env_output_dir}",
            ]
        ),
        encoding="utf-8",
    )

    class _FakeClient:
        def __init__(self, config) -> None:
            self.config = config

    class _FakeAdapter:
        def __init__(self, client) -> None:
            self.client = client

        def fetch_snapshot(self) -> BrokerPortfolioSnapshot:
            assert self.client.config.api_key == "dotenv-key"
            assert self.client.config.api_secret == "dotenv-secret"
            assert self.client.config.environment == Trading212Environment.DEMO
            return snapshot

    monkeypatch.delenv("TRADING212_API_KEY", raising=False)
    monkeypatch.delenv("TRADING212_API_SECRET", raising=False)
    monkeypatch.delenv("TRADING212_ENV", raising=False)
    monkeypatch.delenv("FIN_GURU_PORTFOLIO_DIR", raising=False)
    monkeypatch.setattr(trading212_sync_cli, "project_root", tmp_path)
    monkeypatch.setattr(trading212_sync_cli, "Trading212Client", _FakeClient)
    monkeypatch.setattr(trading212_sync_cli, "Trading212Adapter", _FakeAdapter)

    exit_code = trading212_sync_cli.main([])

    assert exit_code == 0
    assert any(path.name.startswith("Portfolio_Positions_") for path in env_output_dir.iterdir())
    assert (env_output_dir / "Balances_for_Account_TRADING212.csv").exists()


def test_sync_cli_requires_credentials(tmp_path: Path, capsys, monkeypatch) -> None:
    """CLI should fail fast when Trading 212 credentials are missing."""
    from src.utils import trading212_sync_cli

    monkeypatch.delenv("TRADING212_API_KEY", raising=False)
    monkeypatch.delenv("TRADING212_API_SECRET", raising=False)
    monkeypatch.delenv("TRADING212_ENV", raising=False)
    monkeypatch.delenv("FIN_GURU_PORTFOLIO_DIR", raising=False)
    monkeypatch.setattr(trading212_sync_cli, "project_root", tmp_path)

    exit_code = trading212_sync_cli.main(["--output-dir", str(tmp_path)])
    captured = capsys.readouterr()

    assert exit_code == 2
    assert "TRADING212_API_KEY" in captured.err
