# Database retention contract

The 2026-10-04 storage migration keeps the analytical output lifecycle and script facts needed by the current website and historical Quantum rebuilds.

- `outputs`, `coinbases`, and `stxos_*_archive` retain `scripthex`, script type, outpoint, address, amount, creation height and spending metadata.
- Stored `asm` and `descriptor` are retired. The Core parser still uses RPC assembly/descriptors in memory for classification and public-key address extraction.
- `spendingscript` and `spendingwitness` are retained for P2SH, P2WSH and unusual types. They are not retained for `pubkey`, `pubkeyhash`, `witness_v0_keyhash` or `witness_v1_taproot`.
- `op_returns` retains transaction/accounting metadata, but no longer retains the script payload. Do not remove this table: verification tools use its rows.
- `key_outputs_all.source_table` is retired. The similarly named P2PK-cache field is unrelated and retained.
- STXO archive ranges describe spending heights. Incremental discovery skips ranges ending at or before its prior freeze. Historical reconstruction still queries old ranges when needed.
- Generic archive key-type/script-hash indexes use key columns and predicates without including large script payloads. Dedicated P2PK covering indexes remain. New archives use an explicit index policy instead of copying every live-output index.
- The address/blockheight indexes cover address-only lookups on active P2SH/P2WSH tables; do not recreate redundant address-only indexes. The canonical active-key index name is `active_key_outputs_keyhash20_idx`.

On the production host, `/Users/wicked/Projects/onchain/.storage-maintenance` gates blocknotify ingestion and the hourly cron. Core continues collecting blocks. Removing the marker allows catch-up from the database checkpoint. Do not run production publishing entry points as tests.

The external wrapper preserves coinbase mirror refresh and OP_RETURN archiving every six-block bucket. Legacy UTXO/coinbase research CSV generation is now opt-in using `ONCHAIN_RESEARCH_STATS=1`; published website producers do not require those CSV updates. The optional UTXO calculation uses session-local scratch tables.

Detailed evidence, backups, conservation checks and migration progress live in the local machine-maintenance workspace at `/Users/wicked/Projects/repos/security/pipeline-cleanup-2026-10-04/`.
