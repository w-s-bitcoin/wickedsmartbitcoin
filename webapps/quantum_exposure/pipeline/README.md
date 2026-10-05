# Quantum Exposure pipeline

Quantum analysis is separate from the hourly and onchain website jobs. The
current manually triggered entry point is `run_daily_snapshot_pipeline.py`.
It selects the next 1,000-block target, invokes the exposure table builders,
produces/enriches CSVs, updates indexes, publishes a finalized generation marker,
and synchronizes the standalone checkout. These operations access production
PostgreSQL and generated data; they are not development smoke tests.

- [Pipeline audit and measured findings, 2026-10-05](audit/README.md)
- [Proposed incremental architecture and automatic 1,000-block operation](audit/REDESIGN.md)
- [Database retention contract](RETENTION.md)
- [Current methodology](../METHODOLOGY.txt)
- [Repository production automation boundaries](../../../scripts/automation/README.md)

The audit's schema and scheduling design are proposals. They have not replaced
the production pipeline or enabled a schedule. Its reproduction tools are
read-only; the draft DDL is intended for a disposable database only.
