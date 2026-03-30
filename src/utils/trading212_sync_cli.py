#!/usr/bin/env python3
"""Read-only Trading 212 sync CLI for Finance Guru."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Add project root to path for direct script execution.
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from src.config import FinGuruConfig
from src.integrations.trading212 import (
    LegacySnapshotWriter,
    Trading212Adapter,
    Trading212Client,
    Trading212Config,
)


def _load_project_env() -> None:
    """Load the repository-standard .env file without overriding shell vars."""
    load_dotenv(project_root / ".env", override=False)


def _resolve_output_dir(cli_output_dir: str | None) -> Path:
    """Resolve the snapshot output directory after loading env vars."""
    if cli_output_dir:
        return Path(cli_output_dir)

    env_output_dir = os.getenv("FIN_GURU_PORTFOLIO_DIR")
    if env_output_dir:
        return Path(env_output_dir)

    return FinGuruConfig.PORTFOLIO_DIR


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="Sync Trading 212 account data into Finance Guru legacy CSV snapshots.",
    )
    parser.add_argument(
        "--env",
        dest="environment",
        choices=["live", "demo"],
        default=None,
        help="Trading 212 environment override. Defaults to TRADING212_ENV.",
    )
    parser.add_argument(
        "--api-key",
        dest="api_key",
        default=None,
        help="Trading 212 API key override. Defaults to TRADING212_API_KEY.",
    )
    parser.add_argument(
        "--api-secret",
        dest="api_secret",
        default=None,
        help="Trading 212 API secret override. Defaults to TRADING212_API_SECRET.",
    )
    parser.add_argument(
        "--output-dir",
        dest="output_dir",
        default=None,
        help="Directory for legacy snapshots. Defaults to FIN_GURU_PORTFOLIO_DIR or notebooks/updates.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the Trading 212 snapshot bridge."""
    _load_project_env()
    args = build_parser().parse_args(argv)
    config = Trading212Config.from_env(
        environment=args.environment,
        api_key=args.api_key,
        api_secret=args.api_secret,
    )

    if not config.api_key or not config.api_secret:
        print(
            "Missing Trading 212 credentials. Set TRADING212_API_KEY and "
            "TRADING212_API_SECRET or pass --api-key/--api-secret.",
            file=sys.stderr,
        )
        return 2

    output_dir = _resolve_output_dir(args.output_dir)

    snapshot = Trading212Adapter(Trading212Client(config)).fetch_snapshot()
    paths = LegacySnapshotWriter(output_dir).write(snapshot)

    print(f"Wrote positions snapshot to {paths.positions}")
    print(f"Wrote balances snapshot to {paths.balances}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
