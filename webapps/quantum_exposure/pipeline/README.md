# Quantum Exposure pipeline

Quantum analysis is separate from the hourly and onchain website jobs. The v2
entry point is `run_quantum_worker.py`; its explicit configuration selects the
database, isolated state directory, and two publication destinations. It discovers
eligible 1,000-block targets from the committed ingestion height/hash, updates
compact analytical state in bounded transactions, and publishes validated
immutable generations. See the operating guide for migration, acceptance gates,
pause/resume, scheduler installation, and recovery. These commands access
production PostgreSQL and generated data; they are not development smoke tests.

- [Implemented v2 operating contract and rollout evidence](OPERATIONS_V2.md)

- [Pipeline audit and measured findings, 2026-10-05](audit/README.md)
- [Proposed incremental architecture and automatic 1,000-block operation](audit/REDESIGN.md)
- [Database retention contract](RETENTION.md)
- [Current methodology](../METHODOLOGY.txt)
- [Repository production automation boundaries](../../../scripts/automation/README.md)

The audit records the earlier manually triggered pipeline and its measured
defects. Its draft warehouse DDL remains a proposal, not an executable production
migration. Versioned files in `migrations/` are the implemented additive schema.
The operating guide distinguishes implemented behavior from verified deployment;
the presence of these files does not establish that a scheduler is enabled.

`run_daily_snapshot_pipeline.py` and the older table builders remain for recovery
reference. Their mutation guards refuse to change the frozen legacy seed after
v2 initialization. Do not invoke them to advance a v2 checkpoint.
