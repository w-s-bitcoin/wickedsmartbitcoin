#!/usr/bin/env python3
"""Update active_key_outputs incrementally from key_outputs_all + exposed_keyhash20."""

import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from pipeline_paths import resolve_env_file

env_path = resolve_env_file()
load_dotenv(dotenv_path=env_path)

STRUCTURE_SOURCE_CHECKPOINT = "key_outputs_all"
EXPOSURE_SOURCE_CHECKPOINT = "exposed_keyhash20"
CHECKPOINT_NAME = "active_key_outputs"


def connect():
    conn = psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        database=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
    )
    conn.autocommit = False
    return conn


def table_exists(cur, table_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = %s
        );
        """,
        (table_name,),
    )
    return cur.fetchone()[0]


def get_checkpoint(cur, name: str):
    cur.execute(
        """
        SELECT freeze_blockheight
        FROM analysis_freeze
        WHERE name = %s
        """,
        (name,),
    )
    row = cur.fetchone()
    return None if row is None else int(row[0])


def ensure_is_exposed_column(cur):
    cur.execute(
        """
        ALTER TABLE public.active_key_outputs
        ADD COLUMN IF NOT EXISTS is_exposed BOOLEAN;
        """
    )


def ensure_address_column(cur):
    cur.execute(
        """
        ALTER TABLE public.active_key_outputs
        ADD COLUMN IF NOT EXISTS address TEXT;
        """
    )


def main():
    conn = connect()
    cur = conn.cursor()

    try:
        print("Fetching current source freeze heights...")

        structure_height = get_checkpoint(cur, STRUCTURE_SOURCE_CHECKPOINT)
        if structure_height is None:
            raise RuntimeError("No analysis_freeze row found for 'key_outputs_all'.")

        exposure_height = get_checkpoint(cur, EXPOSURE_SOURCE_CHECKPOINT)
        if exposure_height is None:
            raise RuntimeError("No analysis_freeze row found for 'exposed_keyhash20'.")

        current_freeze_height = min(structure_height, exposure_height)

        print(f"current key_outputs_all height   : {structure_height:,}")
        print(f"current exposed_keyhash20 height : {exposure_height:,}")
        print(f"effective source height          : {current_freeze_height:,}")

        print("\nFetching prior checkpoint...")
        previous_height = get_checkpoint(cur, CHECKPOINT_NAME)
        print(f"previous active_key_outputs height: {previous_height if previous_height is not None else 'none'}")

        exists = table_exists(cur, "active_key_outputs")

        if not exists:
            print("\nactive_key_outputs does not exist, creating from scratch...")

            cur.execute(
                """
                CREATE TABLE public.active_key_outputs (
                    keyhash20 BYTEA NOT NULL,
                    blockheight BIGINT NOT NULL,
                    transactionid TEXT NOT NULL,
                    vout INTEGER NOT NULL,
                    amount BIGINT NOT NULL,
                    script_type TEXT NOT NULL,
                    spendingblock BIGINT,
                    is_exposed BOOLEAN NOT NULL,
                    address TEXT,
                    PRIMARY KEY (blockheight, transactionid, vout)
                );
                """
            )

            print("Collecting currently active keyhash20 values...")
            cur.execute(
                """
                CREATE TEMP TABLE tmp_active_keys (
                    keyhash20 BYTEA PRIMARY KEY
                ) ON COMMIT DROP;
                """
            )

            cur.execute(
                """
                INSERT INTO tmp_active_keys (keyhash20)
                SELECT DISTINCT keyhash20
                FROM key_outputs_all
                WHERE blockheight <= %s
                  AND (spendingblock IS NULL OR spendingblock > %s);
                """,
                (current_freeze_height, current_freeze_height),
            )

            cur.execute("ANALYZE tmp_active_keys;")
            cur.execute("SELECT COUNT(*) FROM tmp_active_keys;")
            count = cur.fetchone()[0]
            print(f"active keys: {count:,}")

            print("\nBuilding active_key_outputs...")
            cur.execute(
                """
                INSERT INTO active_key_outputs (
                    keyhash20,
                    blockheight,
                    transactionid,
                    vout,
                    amount,
                    script_type,
                    spendingblock,
                    is_exposed,
                    address
                )
                SELECT
                    k.keyhash20,
                    k.blockheight,
                    k.transactionid,
                    k.vout,
                    k.amount,
                    k.script_type,
                    k.spendingblock,
                    (e.keyhash20 IS NOT NULL) AS is_exposed,
                    k.address
                FROM key_outputs_all k
                JOIN tmp_active_keys a
                  ON k.keyhash20 = a.keyhash20
                LEFT JOIN exposed_keyhash20 e
                  ON k.keyhash20 = e.keyhash20
                 AND e.exposed_height <= %s
                WHERE k.blockheight <= %s;
                """,
                (current_freeze_height, current_freeze_height),
            )

            cur.execute("SELECT COUNT(*) FROM active_key_outputs;")
            rows = cur.fetchone()[0]
            print(f"rows inserted: {rows:,}")

            print("\nCreating indexes...")
            cur.execute("CREATE INDEX active_key_outputs_key_idx ON active_key_outputs(keyhash20);")
            cur.execute("CREATE INDEX active_key_outputs_block_idx ON active_key_outputs(blockheight);")
            cur.execute("CREATE INDEX active_key_outputs_spend_idx ON active_key_outputs(spendingblock);")
            cur.execute("CREATE INDEX active_key_outputs_exposed_idx ON active_key_outputs(is_exposed);")

            cur.execute("ANALYZE active_key_outputs;")

        else:
            ensure_is_exposed_column(cur)
            ensure_address_column(cur)

            if previous_height is None:
                raise RuntimeError(
                    "active_key_outputs exists but no checkpoint row was found in analysis_freeze."
                )

            if current_freeze_height < previous_height:
                raise RuntimeError(
                    f"Effective source height moved backwards ({previous_height} -> {current_freeze_height})."
                )

            if current_freeze_height == previous_height:
                print("\nNo new blocks to process. Nothing to do.")
                conn.rollback()
                raise SystemExit

            print("\nBuilding changed key set...")
            cur.execute(
                """
                CREATE TEMP TABLE tmp_changed_keys (
                    keyhash20 BYTEA PRIMARY KEY
                ) ON COMMIT DROP;
                """
            )

            print("Adding keys changed in key_outputs_all...")
            cur.execute(
                """
                INSERT INTO tmp_changed_keys (keyhash20)
                SELECT DISTINCT keyhash20
                FROM key_outputs_all
                WHERE blockheight > %s
                  AND blockheight <= %s;
                """,
                (previous_height, current_freeze_height),
            )

            cur.execute(
                """
                INSERT INTO tmp_changed_keys (keyhash20)
                SELECT DISTINCT keyhash20
                FROM key_outputs_all
                WHERE spendingblock > %s
                  AND spendingblock <= %s
                ON CONFLICT DO NOTHING;
                """,
                (previous_height, current_freeze_height),
            )

            print("Adding keys newly exposed in exposed_keyhash20...")
            cur.execute(
                """
                INSERT INTO tmp_changed_keys (keyhash20)
                SELECT keyhash20
                FROM exposed_keyhash20
                WHERE exposed_height > %s
                  AND exposed_height <= %s
                ON CONFLICT DO NOTHING;
                """,
                (previous_height, current_freeze_height),
            )

            cur.execute("ANALYZE tmp_changed_keys;")
            cur.execute("SELECT COUNT(*) FROM tmp_changed_keys;")
            changed_keys = cur.fetchone()[0]
            print(f"affected keys: {changed_keys:,}")

            if changed_keys > 0:
                print("\nBuilding active subset of changed keys...")
                cur.execute(
                    """
                    CREATE TEMP TABLE tmp_active_changed_keys (
                        keyhash20 BYTEA PRIMARY KEY
                    ) ON COMMIT DROP;
                    """
                )

                cur.execute(
                    """
                    INSERT INTO tmp_active_changed_keys (keyhash20)
                    SELECT DISTINCT k.keyhash20
                    FROM key_outputs_all k
                    JOIN tmp_changed_keys t
                      ON k.keyhash20 = t.keyhash20
                    WHERE k.blockheight <= %s
                      AND (k.spendingblock IS NULL OR k.spendingblock > %s);
                    """,
                    (current_freeze_height, current_freeze_height),
                )

                cur.execute("ANALYZE tmp_active_changed_keys;")
                cur.execute("SELECT COUNT(*) FROM tmp_active_changed_keys;")
                active_changed_keys = cur.fetchone()[0]
                print(f"still-active affected keys: {active_changed_keys:,}")

                print("\nDeleting stale rows for affected keys...")
                cur.execute(
                    """
                    DELETE FROM active_key_outputs a
                    USING tmp_changed_keys t
                    WHERE a.keyhash20 = t.keyhash20;
                    """
                )
                print(f"rows deleted: {cur.rowcount:,}")

                if active_changed_keys > 0:
                    print("Reinserting refreshed rows for still-active affected keys...")
                    cur.execute(
                        """
                        INSERT INTO active_key_outputs (
                            keyhash20,
                            blockheight,
                            transactionid,
                            vout,
                            amount,
                            script_type,
                            spendingblock,
                            is_exposed,
                            address
                        )
                        SELECT
                            k.keyhash20,
                            k.blockheight,
                            k.transactionid,
                            k.vout,
                            k.amount,
                            k.script_type,
                            k.spendingblock,
                            (e.keyhash20 IS NOT NULL) AS is_exposed,
                            k.address
                        FROM key_outputs_all k
                        JOIN tmp_active_changed_keys a
                          ON k.keyhash20 = a.keyhash20
                        LEFT JOIN exposed_keyhash20 e
                          ON k.keyhash20 = e.keyhash20
                         AND e.exposed_height <= %s
                        WHERE k.blockheight <= %s
                        ON CONFLICT (blockheight, transactionid, vout) DO UPDATE
                        SET keyhash20 = EXCLUDED.keyhash20,
                            amount = EXCLUDED.amount,
                            script_type = EXCLUDED.script_type,
                            spendingblock = EXCLUDED.spendingblock,
                            is_exposed = EXCLUDED.is_exposed,
                            address = EXCLUDED.address;
                        """,
                        (current_freeze_height, current_freeze_height),
                    )
                    print(f"rows inserted/updated: {cur.rowcount:,}")

            print("\nBackfilling any NULL is_exposed values to FALSE...")
            cur.execute(
                """
                UPDATE active_key_outputs
                SET is_exposed = FALSE
                WHERE is_exposed IS NULL;
                """
            )
            if cur.rowcount:
                print(f"NULL backfills: {cur.rowcount:,}")

            cur.execute("ANALYZE active_key_outputs;")
            cur.execute(
                """
                SELECT
                    COUNT(*) AS rows_total,
                    COUNT(*) FILTER (WHERE is_exposed) AS exposed_rows,
                    COUNT(*) FILTER (WHERE NOT is_exposed) AS not_exposed_rows
                FROM active_key_outputs;
                """
            )
            rows_total, exposed_rows, not_exposed_rows = cur.fetchone()
            print(f"\ncurrent active_key_outputs rows : {rows_total:,}")
            print(f"current exposed rows            : {exposed_rows:,}")
            print(f"current not exposed rows        : {not_exposed_rows:,}")

        print("\nEnsuring exposed index exists...")
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS active_key_outputs_exposed_idx
            ON active_key_outputs(is_exposed);
            """
        )

        print("\nUpserting checkpoint...")
        cur.execute(
            """
            INSERT INTO analysis_freeze (name, freeze_blockheight)
            VALUES (%s, %s)
            ON CONFLICT (name)
            DO UPDATE SET freeze_blockheight = EXCLUDED.freeze_blockheight;
            """,
            (CHECKPOINT_NAME, current_freeze_height),
        )

        conn.commit()
        print("\nactive_key_outputs update complete")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
