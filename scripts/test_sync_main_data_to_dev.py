#!/usr/bin/env python3

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts import sync_main_data_to_dev as syncer


class DevDataSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="wsb-data-sync-test-")
        self.root = Path(self.temp_dir.name)
        self.main_repo = self.root / "wickedsmartbitcoin"
        self.dev_repo = self.root / "wickedsmartbitcoin-dev"
        self.git("init", "-b", "main", str(self.main_repo), cwd=self.root)
        self.git("config", "user.name", "Test User", cwd=self.main_repo)
        self.git("config", "user.email", "test@example.com", cwd=self.main_repo)

        self.write(self.main_repo / "assets" / "daily_price.csv", "date,price\n2026-01-01,1\n")
        self.write(
            self.main_repo / "webapps" / "example" / "webapp_data" / "values.csv",
            "date,value\n2026-01-01,1\n",
        )
        self.write(self.main_repo / "app.js", "const version = 1;\n")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Initial", cwd=self.main_repo)
        self.git("branch", syncer.DEFAULT_DEV_BRANCH, cwd=self.main_repo)
        self.git("worktree", "add", str(self.dev_repo), syncer.DEFAULT_DEV_BRANCH, cwd=self.main_repo)

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def git(*args, cwd):
        return subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    @staticmethod
    def write(path: Path, content: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit_main_update(self, value: int, *, amend: bool = False):
        self.write(
            self.main_repo / "assets" / "daily_price.csv",
            f"date,price\n2026-01-01,{value}\n",
        )
        self.write(
            self.main_repo / "webapps" / "example" / "webapp_data" / "values.csv",
            f"date,value\n2026-01-01,{value}\n",
        )
        self.git("add", "-A", cwd=self.main_repo)
        if amend:
            self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        else:
            self.git("commit", "-m", "Update data", cwd=self.main_repo)

    @staticmethod
    def daily_price_document(generation: int) -> bytes:
        return (
            "date,timestamp,price,daily_high,block_height\n"
            "1/3/09,2009-01-03 23:59:59,0.0,0.0,0\n"
            "1/4/09,2009-01-04 12:00:00,"
            f"{100 + generation},{101 + generation},{900000 + generation}\n"
        ).encode("utf-8")

    @staticmethod
    def three_day_daily_price_document() -> bytes:
        return (
            "date,timestamp,price,daily_high,block_height\n"
            "1/3/09,2009-01-03 23:59:59,0.0,0.0,0\n"
            "1/4/09,2009-01-04 23:59:59,10.0,11.0,1\n"
            "1/5/09,2009-01-05 12:00:00,12.0,13.0,2\n"
        ).encode("utf-8")

    def prepare_daily_price_transition(self):
        initial_data = self.daily_price_document(1)
        initial_marker = syncer.build_daily_price_publication_marker(initial_data)
        (self.dev_repo / syncer.DAILY_PRICE_PATH).write_bytes(initial_data)
        (self.dev_repo / syncer.DAILY_PRICE_MARKER_PATH).parent.mkdir(parents=True, exist_ok=True)
        (self.dev_repo / syncer.DAILY_PRICE_MARKER_PATH).write_bytes(initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add daily-price publication boundary", cwd=self.dev_repo)

        next_data = self.daily_price_document(2)
        (self.main_repo / syncer.DAILY_PRICE_PATH).write_bytes(next_data)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main daily-price update", cwd=self.main_repo)
        return initial_data, next_data

    @staticmethod
    def casascius_documents(generation: int) -> tuple[bytes, bytes]:
        redeem_block = 800000 + generation
        redeem_time = 1700000000 + generation
        tracker = (
            "Status,Address,Type,Index,Value,Balance,Create Block,Create Time,Redeem Block,Redeem Time\n"
            f"Active,active{generation},S1-COIN-1,1,1,1,{700000 + generation},{1600000000 + generation},,\n"
            f"Redeemed,redeemed{generation},S1-COIN-1,2,1,0,700001,1600000001,{redeem_block},{redeem_time}\n"
            f"Unfunded,unfunded{generation},S1-COIN-1,3,1,0,,,,\n"
        ).encode("utf-8")
        panel = {
            "allKey": "all-items",
            "items": {
                "all-items": {
                    "active": 1,
                    "redeemed": 1,
                    "unfunded": 1,
                    "minted": 2,
                    "lastBlock": redeem_block,
                    "lastTime": redeem_time,
                },
                "cas_1btc_2011_s1": {},
            },
        }
        right_panel = (
            "window.CASASCIUS_RIGHT_PANEL_DATA = "
            + json.dumps(panel, separators=(",", ":"), sort_keys=True)
            + ";\n"
        ).encode("utf-8")
        return tracker, right_panel

    def prepare_casascius_transition(self):
        initial_tracker, initial_panel = self.casascius_documents(1)
        initial_marker = syncer.build_casascius_right_panel_marker(initial_tracker, initial_panel)
        tracker_path = self.dev_repo / syncer.CASASCIUS_TRACKER_PATH
        panel_path = self.dev_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH
        tracker_path.parent.mkdir(parents=True, exist_ok=True)
        panel_path.parent.mkdir(parents=True, exist_ok=True)
        tracker_path.write_bytes(initial_tracker)
        panel_path.write_bytes(initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Casascius publication boundary", cwd=self.dev_repo)

        next_tracker, next_panel = self.casascius_documents(2)
        main_tracker = self.main_repo / syncer.CASASCIUS_TRACKER_PATH
        main_panel = self.main_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH
        main_tracker.parent.mkdir(parents=True, exist_ok=True)
        main_panel.parent.mkdir(parents=True, exist_ok=True)
        main_tracker.write_bytes(next_tracker)
        main_panel.write_bytes(next_panel)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main Casascius update", cwd=self.main_repo)
        return (initial_tracker, initial_marker), (next_tracker, next_panel)

    @staticmethod
    def issuance_documents(generation: int):
        generated_utc = f"2026-01-{generation:02d}T00:00:00+00:00"
        latest_height = 900000 + generation
        source = {
            "database": "bitcoin_data",
            "latest_block_height": latest_height,
            "latest_block_time_utc": generated_utc,
            "next_halving_height": 1050000,
            "next_halving_estimated_time_utc": "2028-01-01T00:00:00+00:00",
        }
        chart = {
            "genesis_date": "2009-01-03",
            "fifth_halving_estimate": "2028-01-01",
            "halving_interval": 210000,
            "target_blocks_per_day": 144,
        }
        rows = [
            {
                "date": "2009-01-03",
                "height": 0,
                "epoch": 1,
                "issuance_rate": 0.0,
                "target_rate": 0.0,
            },
            {
                "date": f"2026-01-{generation:02d}",
                "height": latest_height,
                "epoch": 5,
                "issuance_rate": 0.01,
                "target_rate": 0.01,
            },
        ]
        data = {
            "generated_utc": generated_utc,
            "source": source,
            "chart": chart,
            "halvings": [],
            "rows": rows,
            "time_zone_daily": {"UTC": {row["date"]: [row["height"]] for row in rows}},
        }
        preview = {
            "generated_utc": generated_utc,
            "source": source,
            "chart": chart,
            "rows": rows[-1:],
        }
        return (
            json.dumps(data, separators=(",", ":"), ensure_ascii=True) + "\n",
            json.dumps(preview, separators=(",", ":"), ensure_ascii=True) + "\n",
        )

    def prepare_issuance_transition(self):
        initial_data, initial_preview = self.issuance_documents(1)
        self.write(self.dev_repo / syncer.ISSUANCE_DATA_PATH, initial_data)
        self.write(self.dev_repo / syncer.ISSUANCE_PREVIEW_PATH, initial_preview)
        initial_marker = syncer.build_issuance_publication_marker(
            initial_data.encode("utf-8"),
            initial_preview.encode("utf-8"),
        ).decode("utf-8")
        self.write(self.dev_repo / syncer.ISSUANCE_MARKER_PATH, initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Issuance publication boundary", cwd=self.dev_repo)

        next_data, next_preview = self.issuance_documents(2)
        self.write(self.main_repo / syncer.ISSUANCE_DATA_PATH, next_data)
        self.write(self.main_repo / syncer.ISSUANCE_PREVIEW_PATH, next_preview)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main Issuance data update", cwd=self.main_repo)
        return next_data.encode("utf-8"), next_preview.encode("utf-8")

    @staticmethod
    def node_documents(generation: int):
        latest_day = generation + 1
        history = (
            "timestamp,listening,est_unreachable,knots_count,core_v30_count,bip110_count,"
            "total_count,datetime,date\n"
            "1,5,5,1,3,1,10,2026-01-01 00:00:00+00:00,2026-01-01\n"
            f"2,6,6,2,3,1,12,2026-01-{latest_day:02d} 00:00:00+00:00,"
            f"2026-01-{latest_day:02d}\n"
        )
        grouped = "software,version,total_count\nBitcoin Core,30.0,7\nBitcoin Knots,29.1,5\n"
        detail = "software,version,reachable,total_count\nBitcoin Core,30.0,true,7\nBitcoin Knots,29.1,true,5\n"
        updated = f"2026-01-{latest_day:02d}T00:05:00+00:00\n"
        return {
            syncer.NODE_HISTORY_PATH: history.encode("utf-8"),
            syncer.NODE_GROUPED_PATH: grouped.encode("utf-8"),
            syncer.NODE_DETAIL_PATH: detail.encode("utf-8"),
            syncer.NODE_LAST_UPDATED_PATH: updated.encode("utf-8"),
        }

    def prepare_node_transition(self):
        initial = self.node_documents(1)
        initial_marker = syncer.build_node_publication_marker(
            initial[syncer.NODE_HISTORY_PATH],
            initial[syncer.NODE_GROUPED_PATH],
            initial[syncer.NODE_DETAIL_PATH],
            initial[syncer.NODE_LAST_UPDATED_PATH],
        )
        for path, payload in initial.items():
            self.write(self.dev_repo / path, payload.decode("utf-8"))
        self.write(self.dev_repo / syncer.NODE_MARKER_PATH, initial_marker.decode("utf-8"))
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Node Count publication boundary", cwd=self.dev_repo)

        next_documents = self.node_documents(2)
        for path, payload in next_documents.items():
            self.write(self.main_repo / path, payload.decode("utf-8"))
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main Node Count data update", cwd=self.main_repo)
        return initial, next_documents

    @staticmethod
    def dominance_documents(generation: int):
        latest_day = generation + 1
        latest_date = f"2026-01-{latest_day:02d}"
        records = {
            "df_all_clean": 4,
            "btcd_timeseries_historical": 1,
            "btcd_timeseries_current_day": 1,
            "btcd_timeseries_incl_stables_historical": 1,
            "btcd_timeseries_incl_stables_current_day": 1,
            "top10_daily_excl_stables": 2,
            "top10_daily_incl_stables": 2,
            "stable_outliers": 0,
        }
        chart_static = {
            "generated_at_utc": f"{latest_date}T00:00:00+00:00",
            "source_csv": "/tmp/source.csv",
            "latest_date": latest_date,
            "latest_snapshot_date": latest_date,
            "stable_count": 1,
            "default_top_n": 10,
            "records": records,
            "outlier_rules": {},
        }
        values = {
            "btcd_timeseries_historical.csv": "Date,btcd_top10\n2026-01-01,0.50\n",
            "btcd_timeseries_current_day.csv": f"Date,btcd_top10\n{latest_date},0.51\n",
            "btcd_timeseries_incl_stables_historical.csv": (
                "Date,btcd_top10,stabled_top10,otherd_top10\n2026-01-01,0.50,0.10,0.40\n"
            ),
            "btcd_timeseries_incl_stables_current_day.csv": (
                f"Date,btcd_top10,stabled_top10,otherd_top10\n{latest_date},0.51,0.10,0.39\n"
            ),
            "top10_daily_excl_stables.csv": (
                f"Date,Rank,Symbol,Market Cap\n{latest_date},1,BTC,100\n"
                f"{latest_date},2,ETH,50\n"
            ),
            "top10_daily_incl_stables.csv": (
                f"Date,Rank,Symbol,Market Cap\n{latest_date},1,BTC,100\n"
                f"{latest_date},2,USDT,60\n"
            ),
        }
        documents = {
            syncer.DOMINANCE_CHART_STATIC_PATH: json.dumps(
                chart_static, indent=2, ensure_ascii=True
            ).encode("utf-8"),
            syncer.DOMINANCE_LAST_UPDATED_PATH: (
                f"{latest_date}T00:05:00+00:00"
            ).encode("utf-8"),
        }
        documents.update({
            f"{syncer.DOMINANCE_DATA_DIR}/{name}": text.encode("utf-8")
            for name, text in values.items()
        })
        return documents

    def prepare_dominance_transition(self):
        initial = self.dominance_documents(1)
        initial_csvs = {
            name: initial[f"{syncer.DOMINANCE_DATA_DIR}/{name}"]
            for name in syncer.DOMINANCE_LOCAL_CSV_NAMES
        }
        initial_marker = syncer.build_dominance_publication_marker(
            initial[syncer.DOMINANCE_CHART_STATIC_PATH],
            initial_csvs,
            initial[syncer.DOMINANCE_LAST_UPDATED_PATH],
        )
        for path, payload in initial.items():
            self.write(self.dev_repo / path, payload.decode("utf-8"))
        self.write(self.dev_repo / syncer.DOMINANCE_MARKER_PATH, initial_marker.decode("utf-8"))
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Dominance publication boundary", cwd=self.dev_repo)

        next_documents = self.dominance_documents(2)
        for path, payload in next_documents.items():
            self.write(self.main_repo / path, payload.decode("utf-8"))
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main Dominance data update", cwd=self.main_repo)
        return initial, next_documents

    @staticmethod
    def bip110_periods_document(generation: int) -> bytes:
        signal_count = generation
        return (
            ",".join(syncer.BIP110_PERIOD_HEADERS)
            + "\n"
            + "1,927360,929375,completed,0,2016\n"
            + f"2,929376,931391,in_progress,{signal_count},10\n"
            + "3,931392,933407,future,0,0\n"
        ).encode("utf-8")

    @staticmethod
    def bip110_marker_base() -> bytes:
        marker = {
            "generated_utc": "2026-08-25T12:00:00+00:00",
            "source_block_height": 929385,
            "source_block_hash": "00fixture",
            "datasets": {"unrelated": {"keep": True}},
        }
        return (json.dumps(marker, separators=(",", ":")) + "\n").encode("utf-8")

    def prepare_bip110_transition(self):
        initial_periods = self.bip110_periods_document(1)
        initial_marker = syncer.build_bip110_publication_marker(
            initial_periods,
            self.bip110_marker_base(),
        )
        periods_path = self.dev_repo / syncer.BIP110_PERIODS_PATH
        marker_path = self.dev_repo / syncer.BIP110_MARKER_PATH
        periods_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        periods_path.write_bytes(initial_periods)
        marker_path.write_bytes(initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add BIP-110 publication boundary", cwd=self.dev_repo)

        next_periods = self.bip110_periods_document(2)
        main_periods_path = self.main_repo / syncer.BIP110_PERIODS_PATH
        main_periods_path.parent.mkdir(parents=True, exist_ok=True)
        main_periods_path.write_bytes(next_periods)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main BIP-110 periods update", cwd=self.main_repo)
        return (initial_periods, initial_marker), next_periods

    @staticmethod
    def quantum_history_document(generation: int) -> bytes:
        latest_snapshot = 900000 + generation
        lines = [",".join(syncer.QUANTUM_HISTORY_HEADERS)]
        for snapshot in (0, latest_snapshot):
            for activity in ("all", "never_spent", "inactive", "active"):
                values = (
                    1 + generation,
                    2 + generation,
                    3 + generation,
                    generation,
                    generation,
                    generation,
                )
                lines.append(
                    f"{snapshot},all,All,{activity},"
                    + ",".join(str(value) for value in values)
                    + ",0.25"
                )
        return ("\n".join(lines) + "\n").encode("utf-8")

    @staticmethod
    def quantum_marker_base(snapshot_height: int) -> bytes:
        marker = {
            "format": 1,
            "generation_id": f"legacy-snapshot-{snapshot_height}",
            "published_at_utc": "2026-08-25T12:00:00Z",
            "reason": "transition-fixture",
            "snapshot_blockheight": snapshot_height,
            "artifacts": {"unrelated.csv": {"keep": True}},
        }
        return (json.dumps(marker, separators=(",", ":")) + "\n").encode("utf-8")

    def prepare_quantum_transition(self):
        initial_history = self.quantum_history_document(1)
        initial_marker = syncer.build_quantum_publication_marker(
            initial_history,
            self.quantum_marker_base(900001),
        )
        history_path = self.dev_repo / syncer.QUANTUM_HISTORY_PATH
        marker_path = self.dev_repo / syncer.QUANTUM_MARKER_PATH
        history_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        history_path.write_bytes(initial_history)
        marker_path.write_bytes(initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Quantum publication boundary", cwd=self.dev_repo)

        next_history = self.quantum_history_document(2)
        main_history_path = self.main_repo / syncer.QUANTUM_HISTORY_PATH
        main_history_path.parent.mkdir(parents=True, exist_ok=True)
        main_history_path.write_bytes(next_history)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main Quantum history update", cwd=self.main_repo)
        return (initial_history, initial_marker), next_history

    @staticmethod
    def dca_comparison_preview_document(generation: int) -> bytes:
        return (
            "date,BTC,XAU\n"
            f"2026-01-01,{100 + generation},{10 + generation}\n"
            f"2026-01-02,{101 + generation},{11 + generation}\n"
            f"2026-01-03,{102 + generation},{12 + generation}\n"
        ).encode("utf-8")

    def prepare_dca_comparison_transition(self):
        initial = self.dca_comparison_preview_document(1)
        dev_path = self.dev_repo / syncer.DCA_COMPARISON_PREVIEW_PATH
        dev_marker_path = self.dev_repo / syncer.DCA_COMPARISON_MARKER_PATH
        dev_path.parent.mkdir(parents=True, exist_ok=True)
        dev_path.write_bytes(initial)
        stale_marker = json.loads(syncer.build_dca_comparison_publication_marker(initial))
        stale_marker["generated_utc"] = "stale-dev-generation"
        stale_marker["legacy_generation_metadata"] = {"must_not_survive": True}
        dev_marker_path.write_text(json.dumps(stale_marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add DCA Comparison preview", cwd=self.dev_repo)

        updated = self.dca_comparison_preview_document(2)
        main_path = self.main_repo / syncer.DCA_COMPARISON_PREVIEW_PATH
        main_path.parent.mkdir(parents=True, exist_ok=True)
        main_path.write_bytes(updated)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main DCA Comparison preview update", cwd=self.main_repo)
        return initial, updated

    @staticmethod
    def dca_cost_preview_document(generation: int) -> bytes:
        rows = [",".join(syncer.DCA_COST_HEADERS)]
        for index, (days_ago, date_iso, height) in enumerate(
            ((3, "2026-01-01", 100), (2, "2026-01-02", 101), (1, "2026-01-03", 102))
        ):
            price = 100 + generation + index
            rows.append(
                f"{days_ago},0.01,{date_iso},{date_iso} 23:50:00,{height},"
                f"{price},{price + 2},{price + 1},{days_ago},0.01,{days_ago},1,"
                "2026-01-03 23:50:00"
            )
        return ("\n".join(rows) + "\n").encode("utf-8")

    @staticmethod
    def dca_cost_legacy_marker(generation: int) -> bytes:
        marker = {
            "generated_utc": f"2026-01-03T00:00:0{generation}+00:00",
            "source": {
                "path": "assets/daily_price.csv",
                "start_date": "2026-01-01",
                "latest_date": "2026-01-03",
                "latest_timestamp_utc": "2026-01-03T23:50:00+00:00",
                "latest_block_height": 102,
                "latest_price": 104 + generation,
                "duration_days": 3,
            },
            "settings": {"contribution_usd": 1.0},
            "kpis": {"daily_dca": {"generation": generation}},
            "halvings": [],
        }
        return (json.dumps(marker, indent=2) + "\n").encode("utf-8")

    def prepare_dca_cost_transition(self, *, change_main_marker: bool):
        initial_preview = self.dca_cost_preview_document(1)
        initial_marker = self.dca_cost_legacy_marker(1)
        dev_preview = self.dev_repo / syncer.DCA_COST_PREVIEW_PATH
        dev_marker = self.dev_repo / syncer.DCA_COST_MARKER_PATH
        dev_preview.parent.mkdir(parents=True, exist_ok=True)
        dev_preview.write_bytes(initial_preview)
        dev_marker.write_bytes(initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add legacy DCA Cost generation", cwd=self.dev_repo)

        updated_preview = self.dca_cost_preview_document(2)
        updated_marker = self.dca_cost_legacy_marker(2)
        main_preview = self.main_repo / syncer.DCA_COST_PREVIEW_PATH
        main_marker = self.main_repo / syncer.DCA_COST_MARKER_PATH
        main_preview.parent.mkdir(parents=True, exist_ok=True)
        main_preview.write_bytes(updated_preview)
        if change_main_marker:
            main_marker.write_bytes(updated_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Old-main DCA Cost update", cwd=self.main_repo)
        return (initial_preview, initial_marker), (updated_preview, updated_marker)

    def synchronize(self):
        return syncer.synchronize(
            self.main_repo,
            "HEAD",
            self.dev_repo,
            syncer.DEFAULT_DEV_BRANCH,
        )

    def test_dirty_non_data_work_is_preserved(self):
        self.commit_main_update(2)
        self.write(self.main_repo / "app.js", "const version = 2;\n")
        self.git("add", "app.js", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        self.write(self.dev_repo / "app.js", "const draft = 'keep me';\n")
        self.git("add", "app.js", cwd=self.dev_repo)
        self.write(self.dev_repo / "notes" / "unfinished.txt", "untracked draft\n")

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertEqual(
            (self.dev_repo / "assets" / "daily_price.csv").read_text(),
            "date,price\n2026-01-01,2\n",
        )
        self.assertEqual((self.dev_repo / "app.js").read_text(), "const draft = 'keep me';\n")
        self.assertEqual((self.dev_repo / "notes" / "unfinished.txt").read_text(), "untracked draft\n")
        self.assertEqual(self.git("show", "HEAD:app.js", cwd=self.dev_repo), "const version = 1;")
        status = self.git("status", "--short", cwd=self.dev_repo)
        self.assertIn("M  app.js", status)
        self.assertIn("?? notes/", status)

    def test_dirty_data_overlap_defers_without_changes(self):
        self.commit_main_update(2)
        self.write(self.dev_repo / "assets" / "daily_price.csv", "unfinished local data\n")
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / "assets" / "daily_price.csv").read_text(),
            "unfinished local data\n",
        )

    def test_amended_source_commit_is_resynchronized(self):
        self.commit_main_update(2)
        first = self.synchronize()
        self.assertEqual(first.status, "synced")

        self.commit_main_update(3, amend=True)
        second = self.synchronize()

        self.assertEqual(second.status, "synced")
        self.assertEqual(
            (self.dev_repo / "webapps" / "example" / "webapp_data" / "values.csv").read_text(),
            "date,value\n2026-01-01,3\n",
        )
        self.assertEqual(syncer.optional_ref(self.dev_repo, syncer.SYNC_SOURCE_REF), second.source_commit)

    def test_old_main_daily_price_update_synthesizes_coherent_marker(self):
        _, next_data = self.prepare_daily_price_transition()
        self.assertFalse((self.main_repo / syncer.DAILY_PRICE_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.DAILY_PRICE_MARKER_PATH, outcome.paths)
        self.assertEqual((self.dev_repo / syncer.DAILY_PRICE_PATH).read_bytes(), next_data)
        self.assertEqual(
            (self.dev_repo / syncer.DAILY_PRICE_MARKER_PATH).read_bytes(),
            syncer.build_daily_price_publication_marker(next_data),
        )

    def test_dirty_daily_price_marker_defers_synthesized_snapshot(self):
        initial_data, _ = self.prepare_daily_price_transition()
        marker_path = self.dev_repo / syncer.DAILY_PRICE_MARKER_PATH
        dirty_marker = '{"draft":"keep daily price marker"}\n'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.DAILY_PRICE_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(), dirty_marker)
        self.assertEqual((self.dev_repo / syncer.DAILY_PRICE_PATH).read_bytes(), initial_data)

    def test_changed_daily_price_marker_is_preserved_byte_for_byte(self):
        _, next_data = self.prepare_daily_price_transition()
        source_marker = json.loads(syncer.build_daily_price_publication_marker(next_data))
        source_marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker_bytes = (json.dumps(source_marker, indent=2) + "\n").encode("utf-8")
        marker_path = self.main_repo / syncer.DAILY_PRICE_MARKER_PATH
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.write_bytes(source_marker_bytes)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.DAILY_PRICE_MARKER_PATH, outcome.paths)
        self.assertEqual((self.dev_repo / syncer.DAILY_PRICE_MARKER_PATH).read_bytes(), source_marker_bytes)

    def test_daily_price_marker_rejects_invalid_series_semantics(self):
        valid = self.three_day_daily_price_document()
        cases = {
            "missing UTC day": (
                valid.replace(
                    b"1/4/09,2009-01-04 23:59:59",
                    b"1/6/09,2009-01-06 23:59:59",
                ),
                "consecutive day",
            ),
            "decreasing block height": (
                valid.replace(b",12.0,13.0,2\n", b",12.0,13.0,0\n"),
                "block height decreases",
            ),
            "invalid price": (
                valid.replace(b",10.0,11.0,1\n", b",not-a-price,11.0,1\n"),
                "invalid price",
            ),
            "negative price": (
                valid.replace(b",10.0,11.0,1\n", b",-10.0,11.0,1\n"),
                "non-finite or negative price",
            ),
            "non-finite price": (
                valid.replace(b",10.0,11.0,1\n", b",NaN,11.0,1\n"),
                "non-finite or negative price",
            ),
            "negative daily high": (
                valid.replace(b",10.0,11.0,1\n", b",10.0,-11.0,1\n"),
                "non-finite or negative daily_high",
            ),
            "non-finite daily high": (
                valid.replace(b",10.0,11.0,1\n", b",10.0,Infinity,1\n"),
                "non-finite or negative daily_high",
            ),
            "invalid timestamp": (
                valid.replace(b"2009-01-04 23:59:59", b"not-a-timestamp       "),
                "invalid timestamp",
            ),
            "date does not match timestamp": (
                valid.replace(b"1/4/09,2009-01-04", b"1/8/09,2009-01-04"),
                "date does not match its UTC timestamp day",
            ),
        }
        for label, (document, message) in cases.items():
            with self.subTest(label=label):
                with self.assertRaisesRegex(syncer.SyncError, message):
                    syncer.build_daily_price_publication_marker(document)

    def test_invalid_old_main_daily_price_transition_is_rejected_atomically(self):
        initial_data, next_data = self.prepare_daily_price_transition()
        invalid_data = next_data.replace(
            b"1/4/09,2009-01-04 12:00:00",
            b"1/6/09,2009-01-06 12:00:00",
        )
        (self.main_repo / syncer.DAILY_PRICE_PATH).write_bytes(invalid_data)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "consecutive day"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual((self.dev_repo / syncer.DAILY_PRICE_PATH).read_bytes(), initial_data)

    def test_source_daily_price_marker_must_match_exact_csv(self):
        _, next_data = self.prepare_daily_price_transition()
        stale_marker = syncer.build_daily_price_publication_marker(
            self.daily_price_document(99)
        )
        marker_path = self.main_repo / syncer.DAILY_PRICE_MARKER_PATH
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.write_bytes(stale_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        with self.assertRaisesRegex(syncer.SyncError, "does not match the exact CSV"):
            self.synchronize()

        self.assertNotEqual(stale_marker, syncer.build_daily_price_publication_marker(next_data))

    def test_old_main_casascius_update_synthesizes_coherent_marker(self):
        _, (next_tracker, next_panel) = self.prepare_casascius_transition()

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.CASASCIUS_RIGHT_PANEL_PATH, outcome.paths)
        self.assertEqual((self.dev_repo / syncer.CASASCIUS_TRACKER_PATH).read_bytes(), next_tracker)
        self.assertEqual(
            (self.dev_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH).read_bytes(),
            syncer.build_casascius_right_panel_marker(next_tracker, next_panel),
        )

    def test_dirty_casascius_marker_defers_synthesized_snapshot(self):
        (initial_tracker, _), _ = self.prepare_casascius_transition()
        marker_path = self.dev_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH
        dirty_marker = "window.CASASCIUS_RIGHT_PANEL_DATA = {\"draft\":true};\n"
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.CASASCIUS_RIGHT_PANEL_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(), dirty_marker)
        self.assertEqual((self.dev_repo / syncer.CASASCIUS_TRACKER_PATH).read_bytes(), initial_tracker)

    def test_changed_casascius_marker_is_preserved_byte_for_byte(self):
        _, (next_tracker, next_panel) = self.prepare_casascius_transition()
        source_marker = syncer.parse_casascius_right_panel_blob(
            syncer.build_casascius_right_panel_marker(next_tracker, next_panel)
        )
        source_marker["future_schema_extension"] = {"keep": "exactly"}
        source_bytes = (
            "window.CASASCIUS_RIGHT_PANEL_DATA = "
            + json.dumps(source_marker, indent=2)
            + ";\n"
        ).encode("utf-8")
        panel_path = self.main_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH
        panel_path.write_bytes(source_bytes)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.CASASCIUS_RIGHT_PANEL_PATH, outcome.paths)
        self.assertEqual((self.dev_repo / syncer.CASASCIUS_RIGHT_PANEL_PATH).read_bytes(), source_bytes)

    def test_old_main_issuance_update_synthesizes_coherent_marker(self):
        next_data, next_preview = self.prepare_issuance_transition()
        self.assertFalse((self.main_repo / syncer.ISSUANCE_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.ISSUANCE_MARKER_PATH, outcome.paths)
        marker_path = self.dev_repo / syncer.ISSUANCE_MARKER_PATH
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        data = json.loads(next_data)
        self.assertEqual(marker["generated_utc"], data["generated_utc"])
        self.assertEqual(marker["latest_block_height"], data["source"]["latest_block_height"])
        self.assertEqual(marker["row_count"], len(data["rows"]))
        self.assertEqual(marker["first_date"], data["rows"][0]["date"])
        self.assertEqual(marker["latest_date"], data["rows"][-1]["date"])
        self.assertEqual(marker["time_zone_count"], len(data["time_zone_daily"]))
        self.assertEqual(marker["data_sha256"], hashlib.sha256(next_data).hexdigest())
        self.assertEqual(marker["preview_sha256"], hashlib.sha256(next_preview).hexdigest())
        self.assertEqual(marker["schema_version"], 1)
        self.assertEqual(marker["preview"]["sha256"], marker["preview_sha256"])
        self.assertEqual(marker["preview"]["rows"], 1)
        self.assertEqual(marker["preview"]["latest_height"], marker["latest_block_height"])
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_DATA_PATH).read_bytes(), next_data)
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_PREVIEW_PATH).read_bytes(), next_preview)

    def test_dirty_issuance_marker_defers_synthesized_snapshot_unchanged(self):
        self.prepare_issuance_transition()
        marker_path = self.dev_repo / syncer.ISSUANCE_MARKER_PATH
        dirty_marker = '{"draft":"do not replace"}\n'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)
        original_data = (self.dev_repo / syncer.ISSUANCE_DATA_PATH).read_bytes()

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.ISSUANCE_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(encoding="utf-8"), dirty_marker)
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_DATA_PATH).read_bytes(), original_data)

    def test_mismatched_old_main_issuance_generation_is_rejected(self):
        initial_data, initial_preview = self.issuance_documents(1)
        initial_marker = syncer.build_issuance_publication_marker(
            initial_data.encode("utf-8"),
            initial_preview.encode("utf-8"),
        ).decode("utf-8")
        self.write(self.dev_repo / syncer.ISSUANCE_DATA_PATH, initial_data)
        self.write(self.dev_repo / syncer.ISSUANCE_PREVIEW_PATH, initial_preview)
        self.write(self.dev_repo / syncer.ISSUANCE_MARKER_PATH, initial_marker)
        self.git("add", "-A", cwd=self.dev_repo)
        self.git("commit", "-m", "Add Issuance publication boundary", cwd=self.dev_repo)

        next_data, _ = self.issuance_documents(2)
        _, mismatched_preview = self.issuance_documents(3)
        self.write(self.main_repo / syncer.ISSUANCE_DATA_PATH, next_data)
        self.write(self.main_repo / syncer.ISSUANCE_PREVIEW_PATH, mismatched_preview)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "-m", "Incomplete old-main Issuance update", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "same generation"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_DATA_PATH).read_text(), initial_data)
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_PREVIEW_PATH).read_text(), initial_preview)

    def test_changed_source_marker_is_preserved_byte_for_byte(self):
        next_data, next_preview = self.prepare_issuance_transition()
        source_marker = json.loads(syncer.build_issuance_publication_marker(next_data, next_preview))
        source_marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker_bytes = (
            json.dumps(source_marker, indent=2, ensure_ascii=False) + "\n"
        ).encode("utf-8")
        marker_path = self.main_repo / syncer.ISSUANCE_MARKER_PATH
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.write_bytes(source_marker_bytes)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.ISSUANCE_MARKER_PATH, outcome.paths)
        self.assertEqual((self.dev_repo / syncer.ISSUANCE_MARKER_PATH).read_bytes(), source_marker_bytes)

    def test_old_main_node_update_synthesizes_coherent_marker(self):
        _, next_documents = self.prepare_node_transition()
        self.assertFalse((self.main_repo / syncer.NODE_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.NODE_MARKER_PATH, outcome.paths)
        marker = json.loads((self.dev_repo / syncer.NODE_MARKER_PATH).read_text())
        expected = json.loads(syncer.build_node_publication_marker(
            next_documents[syncer.NODE_HISTORY_PATH],
            next_documents[syncer.NODE_GROUPED_PATH],
            next_documents[syncer.NODE_DETAIL_PATH],
            next_documents[syncer.NODE_LAST_UPDATED_PATH],
        ))
        self.assertEqual(marker, expected)
        for path, payload in next_documents.items():
            self.assertEqual((self.dev_repo / path).read_bytes(), payload)

    def test_dirty_node_marker_defers_synthesized_snapshot_unchanged(self):
        initial, _ = self.prepare_node_transition()
        marker_path = self.dev_repo / syncer.NODE_MARKER_PATH
        dirty_marker = '{"draft":"keep node marker"}'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.NODE_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(), dirty_marker)
        self.assertEqual((self.dev_repo / syncer.NODE_HISTORY_PATH).read_bytes(), initial[syncer.NODE_HISTORY_PATH])

    def test_mismatched_old_main_node_companions_are_rejected(self):
        initial, _ = self.prepare_node_transition()
        self.write(
            self.main_repo / syncer.NODE_DETAIL_PATH,
            "software,version,reachable,total_count\nBitcoin Core,30.0,true,999\n",
        )
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "totals disagree"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual((self.dev_repo / syncer.NODE_DETAIL_PATH).read_bytes(), initial[syncer.NODE_DETAIL_PATH])

    def test_old_main_dominance_update_synthesizes_coherent_marker(self):
        _, next_documents = self.prepare_dominance_transition()
        self.assertFalse((self.main_repo / syncer.DOMINANCE_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.DOMINANCE_MARKER_PATH, outcome.paths)
        csvs = {
            name: next_documents[f"{syncer.DOMINANCE_DATA_DIR}/{name}"]
            for name in syncer.DOMINANCE_LOCAL_CSV_NAMES
        }
        expected = json.loads(syncer.build_dominance_publication_marker(
            next_documents[syncer.DOMINANCE_CHART_STATIC_PATH],
            csvs,
            next_documents[syncer.DOMINANCE_LAST_UPDATED_PATH],
        ))
        marker = json.loads((self.dev_repo / syncer.DOMINANCE_MARKER_PATH).read_text())
        self.assertEqual(marker, expected)
        self.assertNotIn("daily_price.csv", marker["artifacts"])
        for path, payload in next_documents.items():
            self.assertEqual((self.dev_repo / path).read_bytes(), payload)

    def test_dirty_dominance_marker_defers_synthesized_snapshot_unchanged(self):
        initial, _ = self.prepare_dominance_transition()
        marker_path = self.dev_repo / syncer.DOMINANCE_MARKER_PATH
        dirty_marker = '{"draft":"keep dominance marker"}'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.DOMINANCE_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(), dirty_marker)
        self.assertEqual(
            (self.dev_repo / syncer.DOMINANCE_CHART_STATIC_PATH).read_bytes(),
            initial[syncer.DOMINANCE_CHART_STATIC_PATH],
        )

    def test_mismatched_old_main_dominance_companions_are_rejected(self):
        initial, _ = self.prepare_dominance_transition()
        chart_path = self.main_repo / syncer.DOMINANCE_CHART_STATIC_PATH
        chart = json.loads(chart_path.read_text())
        chart["records"]["btcd_timeseries_current_day"] = 2
        self.write(chart_path, json.dumps(chart, indent=2))
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "row count disagrees"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.DOMINANCE_CHART_STATIC_PATH).read_bytes(),
            initial[syncer.DOMINANCE_CHART_STATIC_PATH],
        )

    def test_old_main_bip110_period_update_synthesizes_coherent_marker(self):
        (_, initial_marker), next_periods = self.prepare_bip110_transition()
        self.assertFalse((self.main_repo / syncer.BIP110_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.BIP110_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.BIP110_PERIODS_PATH).read_bytes(),
            next_periods,
        )
        expected_marker = syncer.build_bip110_publication_marker(
            next_periods,
            initial_marker,
        )
        self.assertEqual(
            (self.dev_repo / syncer.BIP110_MARKER_PATH).read_bytes(),
            expected_marker,
        )
        syncer.validate_bip110_publication_marker(next_periods, expected_marker)

    def test_dirty_bip110_marker_defers_synthesized_snapshot_unchanged(self):
        (initial_periods, _), _ = self.prepare_bip110_transition()
        marker_path = self.dev_repo / syncer.BIP110_MARKER_PATH
        dirty_marker = '{"draft":"keep BIP-110 marker"}\n'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.BIP110_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(encoding="utf-8"), dirty_marker)
        self.assertEqual(
            (self.dev_repo / syncer.BIP110_PERIODS_PATH).read_bytes(),
            initial_periods,
        )

    def test_incoherent_source_bip110_marker_is_rejected_atomically(self):
        (initial_periods, initial_marker), next_periods = self.prepare_bip110_transition()
        marker = json.loads(
            syncer.build_bip110_publication_marker(next_periods, initial_marker)
        )
        marker["datasets"]["bip110_periods"]["sha256"] = "0" * 64
        marker_path = self.main_repo / syncer.BIP110_MARKER_PATH
        marker_path.write_text(json.dumps(marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "exact periods CSV"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.BIP110_PERIODS_PATH).read_bytes(),
            initial_periods,
        )

    def test_changed_source_bip110_marker_is_preserved_byte_for_byte(self):
        (_, initial_marker), next_periods = self.prepare_bip110_transition()
        marker = json.loads(
            syncer.build_bip110_publication_marker(next_periods, initial_marker)
        )
        marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker = (json.dumps(marker, indent=2) + "\n").encode("utf-8")
        marker_path = self.main_repo / syncer.BIP110_MARKER_PATH
        marker_path.write_bytes(source_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.BIP110_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.BIP110_MARKER_PATH).read_bytes(),
            source_marker,
        )

    def test_old_main_quantum_history_update_synthesizes_coherent_marker(self):
        (_, initial_marker), next_history = self.prepare_quantum_transition()
        self.assertFalse((self.main_repo / syncer.QUANTUM_MARKER_PATH).exists())

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.QUANTUM_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.QUANTUM_HISTORY_PATH).read_bytes(),
            next_history,
        )
        expected_marker = syncer.build_quantum_publication_marker(
            next_history,
            initial_marker,
        )
        self.assertEqual(
            (self.dev_repo / syncer.QUANTUM_MARKER_PATH).read_bytes(),
            expected_marker,
        )
        syncer.validate_quantum_publication_marker(next_history, expected_marker)

    def test_dirty_quantum_marker_defers_synthesized_snapshot_unchanged(self):
        (initial_history, _), _ = self.prepare_quantum_transition()
        marker_path = self.dev_repo / syncer.QUANTUM_MARKER_PATH
        dirty_marker = '{"draft":"keep Quantum marker"}\n'
        self.write(marker_path, dirty_marker)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.QUANTUM_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(encoding="utf-8"), dirty_marker)
        self.assertEqual(
            (self.dev_repo / syncer.QUANTUM_HISTORY_PATH).read_bytes(),
            initial_history,
        )

    def test_incoherent_source_quantum_marker_is_rejected_atomically(self):
        (initial_history, initial_marker), next_history = self.prepare_quantum_transition()
        marker = json.loads(
            syncer.build_quantum_publication_marker(next_history, initial_marker)
        )
        marker["artifacts"]["historical_eco.csv"]["rows"] += 1
        marker_path = self.main_repo / syncer.QUANTUM_MARKER_PATH
        marker_path.write_text(json.dumps(marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "exact historical CSV"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.QUANTUM_HISTORY_PATH).read_bytes(),
            initial_history,
        )

    def test_changed_source_quantum_marker_is_preserved_byte_for_byte(self):
        (_, initial_marker), next_history = self.prepare_quantum_transition()
        marker = json.loads(
            syncer.build_quantum_publication_marker(next_history, initial_marker)
        )
        marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker = (json.dumps(marker, indent=2) + "\n").encode("utf-8")
        marker_path = self.main_repo / syncer.QUANTUM_MARKER_PATH
        marker_path.write_bytes(source_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.QUANTUM_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.QUANTUM_MARKER_PATH).read_bytes(),
            source_marker,
        )

    def test_old_main_dca_comparison_update_synthesizes_marker(self):
        _, updated = self.prepare_dca_comparison_transition()

        outcome = self.synchronize()

        expected = syncer.build_dca_comparison_publication_marker(updated)
        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.DCA_COMPARISON_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COMPARISON_PREVIEW_PATH).read_bytes(), updated
        )
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COMPARISON_MARKER_PATH).read_bytes(), expected
        )
        synthesized = json.loads(expected)
        self.assertEqual(set(synthesized), {"schema_version", "artifact"})
        self.assertNotIn("generated_utc", synthesized)

    def test_dirty_dca_comparison_marker_defers_synthesis(self):
        initial, _ = self.prepare_dca_comparison_transition()
        marker_path = self.dev_repo / syncer.DCA_COMPARISON_MARKER_PATH
        dirty_marker = '{"draft":"keep comparison marker"}\n'
        marker_path.write_text(dirty_marker, encoding="utf-8")
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "deferred-overlap")
        self.assertIn(syncer.DCA_COMPARISON_MARKER_PATH, outcome.paths)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_text(encoding="utf-8"), dirty_marker)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COMPARISON_PREVIEW_PATH).read_bytes(), initial
        )

    def test_incoherent_source_dca_comparison_marker_is_rejected(self):
        initial, updated = self.prepare_dca_comparison_transition()
        marker = json.loads(syncer.build_dca_comparison_publication_marker(updated))
        marker["artifact"]["sha256"] = "0" * 64
        marker_path = self.main_repo / syncer.DCA_COMPARISON_MARKER_PATH
        marker_path.write_text(json.dumps(marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "exact preview CSV"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COMPARISON_PREVIEW_PATH).read_bytes(), initial
        )

    def test_changed_source_dca_comparison_marker_is_preserved(self):
        _, updated = self.prepare_dca_comparison_transition()
        marker = json.loads(syncer.build_dca_comparison_publication_marker(updated))
        marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker = (json.dumps(marker, indent=2) + "\n").encode("utf-8")
        marker_path = self.main_repo / syncer.DCA_COMPARISON_MARKER_PATH
        marker_path.write_bytes(source_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COMPARISON_MARKER_PATH).read_bytes(), source_marker
        )

    def test_changed_legacy_dca_cost_marker_is_strengthened(self):
        _, (updated_preview, updated_legacy_marker) = self.prepare_dca_cost_transition(
            change_main_marker=True
        )

        outcome = self.synchronize()

        expected = syncer.build_dca_cost_publication_marker(
            updated_preview, updated_legacy_marker
        )
        self.assertEqual(outcome.status, "synced")
        self.assertIn(syncer.DCA_COST_MARKER_PATH, outcome.paths)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_PREVIEW_PATH).read_bytes(), updated_preview
        )
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_MARKER_PATH).read_bytes(), expected
        )
        self.assertEqual(json.loads(expected)["kpis"]["daily_dca"]["generation"], 2)

    def test_dca_cost_payload_only_update_is_rejected_atomically(self):
        (initial_preview, initial_marker), _ = self.prepare_dca_cost_transition(
            change_main_marker=False
        )
        marker_path = self.dev_repo / syncer.DCA_COST_MARKER_PATH
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "without its publication metadata"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(marker_path.read_bytes(), initial_marker)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_PREVIEW_PATH).read_bytes(), initial_preview
        )

    def test_incoherent_legacy_dca_cost_source_bounds_are_rejected(self):
        (initial_preview, _), _ = self.prepare_dca_cost_transition(change_main_marker=True)
        marker_path = self.main_repo / syncer.DCA_COST_MARKER_PATH
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        marker["source"]["latest_block_height"] = 999
        marker_path.write_text(json.dumps(marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "source bounds"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_PREVIEW_PATH).read_bytes(), initial_preview
        )

    def test_partial_source_dca_cost_marker_is_rejected(self):
        (initial_preview, _), _ = self.prepare_dca_cost_transition(change_main_marker=True)
        marker_path = self.main_repo / syncer.DCA_COST_MARKER_PATH
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        marker["schema_version"] = 1
        marker_path.write_text(json.dumps(marker) + "\n", encoding="utf-8")
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)
        original_head = self.git("rev-parse", "HEAD", cwd=self.dev_repo)

        with self.assertRaisesRegex(syncer.SyncError, "no artifact evidence"):
            self.synchronize()

        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.dev_repo), original_head)
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_PREVIEW_PATH).read_bytes(), initial_preview
        )

    def test_changed_coherent_dca_cost_marker_is_preserved(self):
        _, (updated_preview, updated_legacy_marker) = self.prepare_dca_cost_transition(
            change_main_marker=True
        )
        marker = json.loads(
            syncer.build_dca_cost_publication_marker(updated_preview, updated_legacy_marker)
        )
        marker["future_schema_extension"] = {"keep": "exactly"}
        source_marker = (json.dumps(marker, indent=2) + "\n").encode("utf-8")
        marker_path = self.main_repo / syncer.DCA_COST_MARKER_PATH
        marker_path.write_bytes(source_marker)
        self.git("add", "-A", cwd=self.main_repo)
        self.git("commit", "--amend", "--no-edit", cwd=self.main_repo)

        outcome = self.synchronize()

        self.assertEqual(outcome.status, "synced")
        self.assertEqual(
            (self.dev_repo / syncer.DCA_COST_MARKER_PATH).read_bytes(), source_marker
        )


if __name__ == "__main__":
    unittest.main()
