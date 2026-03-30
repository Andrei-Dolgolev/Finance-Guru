"""Trading 212 read-only bridge for legacy Finance Guru CSV consumers."""

from __future__ import annotations

import base64
import csv
import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

import requests


class Trading212Environment(StrEnum):
    """Supported Trading 212 environments."""

    LIVE = "live"
    DEMO = "demo"


@dataclass(frozen=True)
class Trading212Config:
    """Connection settings for the Trading 212 API."""

    api_key: str
    api_secret: str
    environment: Trading212Environment = Trading212Environment.LIVE

    @property
    def base_url(self) -> str:
        """Return the Trading 212 host for the selected environment."""
        if self.environment == Trading212Environment.DEMO:
            return "https://demo.trading212.com"
        return "https://live.trading212.com"

    @classmethod
    def from_env(
        cls,
        environment: str | None = None,
        api_key: str | None = None,
        api_secret: str | None = None,
    ) -> Trading212Config:
        """Build config from environment variables with optional overrides."""
        resolved_environment = environment or os.getenv("TRADING212_ENV", "live")
        return cls(
            api_key=api_key or os.getenv("TRADING212_API_KEY", ""),
            api_secret=api_secret or os.getenv("TRADING212_API_SECRET", ""),
            environment=Trading212Environment(resolved_environment.lower()),
        )


@dataclass(frozen=True)
class SnapshotPosition:
    """Normalized position data for legacy snapshot export."""

    instrument_code: str
    ticker: str
    name: str
    quantity: float
    average_cost_basis: float
    current_price: float
    current_value: float
    unrealized_pl: float
    unrealized_pl_pct: float
    daily_pl: float
    daily_pl_pct: float


@dataclass(frozen=True)
class SnapshotBalances:
    """Normalized balance data for legacy snapshot export."""

    cash_available: float
    cash_reserved: float
    total_value: float
    invested_value: float
    unrealized_pl: float


@dataclass(frozen=True)
class BrokerPortfolioSnapshot:
    """Read-only broker portfolio snapshot."""

    broker: str
    positions: list[SnapshotPosition]
    balances: SnapshotBalances
    captured_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True)
class SnapshotPaths:
    """Written snapshot file paths."""

    positions: Path
    balances: Path


class Trading212Client:
    """Thin HTTP client for Trading 212."""

    def __init__(self, config: Trading212Config) -> None:
        self.config = config
        token = base64.b64encode(
            f"{config.api_key}:{config.api_secret}".encode()
        ).decode()
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
            }
        )

    def get_account_summary(self) -> dict[str, Any]:
        """Fetch account summary data."""
        return self._get_json("/api/v0/equity/account/summary")

    def get_positions(self) -> list[dict[str, Any]]:
        """Fetch open positions."""
        response = self._get_json("/api/v0/equity/positions")
        if not isinstance(response, list):
            msg = "Trading 212 positions response must be a list"
            raise ValueError(msg)
        return response

    def _get_json(self, path: str) -> Any:
        """Fetch and return JSON from the Trading 212 API."""
        response = self.session.get(f"{self.config.base_url}{path}", timeout=10)
        response.raise_for_status()
        return response.json()


class Trading212Adapter:
    """Normalize Trading 212 payloads into Finance Guru snapshot objects."""

    def __init__(self, client: Trading212Client | Any) -> None:
        self.client = client

    def fetch_snapshot(self) -> BrokerPortfolioSnapshot:
        """Fetch and normalize the Trading 212 account snapshot."""
        summary = self.client.get_account_summary()
        positions_payload = self.client.get_positions()

        balances = SnapshotBalances(
            cash_available=self._as_float(summary, "cash", "availableToTrade"),
            cash_reserved=self._as_float(summary, "cash", "reservedForOrders"),
            total_value=self._as_float(summary, "totalValue"),
            invested_value=self._as_float(summary, "investments", "currentValue"),
            unrealized_pl=self._as_float(
                summary, "investments", "unrealizedProfitLoss"
            ),
        )

        positions = [self._normalize_position(position) for position in positions_payload]

        return BrokerPortfolioSnapshot(
            broker="trading212",
            positions=positions,
            balances=balances,
        )

    def _normalize_position(self, payload: dict[str, Any]) -> SnapshotPosition:
        instrument = payload.get("instrument") or {}
        wallet_impact = payload.get("walletImpact") or {}
        instrument_code = str(instrument.get("ticker") or "").strip().upper()
        name = str(instrument.get("name") or instrument_code or "Unknown Instrument")
        total_cost = self._as_float(wallet_impact, "totalCost")
        unrealized_pl = self._as_float(wallet_impact, "unrealizedProfitLoss")
        unrealized_pl_pct = (unrealized_pl / total_cost * 100) if total_cost else 0.0

        return SnapshotPosition(
            instrument_code=instrument_code,
            ticker=self._normalize_ticker(instrument_code),
            name=name,
            quantity=self._as_float(payload, "quantity"),
            average_cost_basis=self._as_float(payload, "averagePricePaid"),
            current_price=self._as_float(payload, "currentPrice"),
            current_value=self._as_float(wallet_impact, "currentValue"),
            unrealized_pl=unrealized_pl,
            unrealized_pl_pct=round(unrealized_pl_pct, 2),
            daily_pl=0.0,
            daily_pl_pct=0.0,
        )

    @staticmethod
    def _normalize_ticker(instrument_code: str) -> str:
        """Convert Trading 212 instrument identifiers to display tickers."""
        if not instrument_code:
            return "UNKNOWN"
        primary = instrument_code.split("_", 1)[0]
        cleaned = "".join(char for char in primary if char.isalnum()).upper()
        return cleaned or "UNKNOWN"

    @staticmethod
    def _as_float(payload: dict[str, Any], *path: str) -> float:
        """Safely read nested numeric values."""
        current: Any = payload
        for key in path:
            if not isinstance(current, dict):
                return 0.0
            current = current.get(key, 0.0)
        try:
            return float(current)
        except (TypeError, ValueError):
            return 0.0


class LegacySnapshotWriter:
    """Write broker snapshots into Finance Guru's current CSV contract."""

    def __init__(self, output_dir: Path) -> None:
        self.output_dir = Path(output_dir)

    def write(self, snapshot: BrokerPortfolioSnapshot) -> SnapshotPaths:
        """Persist the legacy positions and balances snapshots."""
        self.output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = snapshot.captured_at.strftime("%b-%d-%Y")
        positions_path = self.output_dir / f"Portfolio_Positions_{timestamp}.csv"
        balances_path = self.output_dir / "Balances_for_Account_TRADING212.csv"

        self._write_positions_csv(positions_path, snapshot.positions)
        self._write_balances_csv(balances_path, snapshot.balances)

        return SnapshotPaths(positions=positions_path, balances=balances_path)

    def _write_positions_csv(
        self, positions_path: Path, positions: list[SnapshotPosition]
    ) -> None:
        fieldnames = [
            "Symbol",
            "Description",
            "Quantity",
            "Last Price",
            "Current Value",
            "Today's Gain/Loss Dollar",
            "Today's Gain/Loss Percent",
            "Total Gain/Loss Dollar",
            "Total Gain/Loss Percent",
            "Average Cost Basis",
            "Type",
        ]

        with positions_path.open("w", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
            writer.writeheader()
            for position in positions:
                writer.writerow(
                    {
                        "Symbol": position.ticker,
                        "Description": position.name,
                        "Quantity": self._format_quantity(position.quantity),
                        "Last Price": self._format_money(position.current_price),
                        "Current Value": self._format_money(position.current_value),
                        "Today's Gain/Loss Dollar": self._format_money(position.daily_pl),
                        "Today's Gain/Loss Percent": self._format_percent(
                            position.daily_pl_pct
                        ),
                        "Total Gain/Loss Dollar": self._format_money(
                            position.unrealized_pl
                        ),
                        "Total Gain/Loss Percent": self._format_percent(
                            position.unrealized_pl_pct
                        ),
                        "Average Cost Basis": self._format_money(
                            position.average_cost_basis
                        ),
                        "Type": "Cash",
                    }
                )

    def _write_balances_csv(self, balances_path: Path, balances: SnapshotBalances) -> None:
        rows = [
            ("Total account value", self._format_money(balances.total_value)),
            ("Settled cash", self._format_money(balances.cash_available)),
            ("Net debit", self._format_money(0.0)),
            ("Account equity percentage", "100%"),
            ("Margin interest accrued this month", self._format_money(0.0)),
            ("Cash reserved for orders", self._format_money(balances.cash_reserved)),
            ("Invested value", self._format_money(balances.invested_value)),
            ("Unrealized profit/loss", self._format_money(balances.unrealized_pl)),
        ]

        with balances_path.open("w", newline="") as csv_file:
            writer = csv.writer(csv_file)
            for row in rows:
                writer.writerow(row)

    @staticmethod
    def _format_money(value: float) -> str:
        return f"{value:.2f}"

    @staticmethod
    def _format_percent(value: float) -> str:
        return f"{value:.2f}%"

    @staticmethod
    def _format_quantity(value: float) -> str:
        return format(value, "g")
