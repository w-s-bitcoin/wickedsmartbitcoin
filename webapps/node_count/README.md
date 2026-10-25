# Bitcoin Node Count

## PNG exports

Chart PNG downloads capture the current view and selected light or dark theme
before loading export assets. They retain 3840 × 2160 output and use the shared
creator, current Lightning donation QR, and canonical URL footer. Light exports
have white chart and footer backgrounds with dark axis labels and grid lines.
The chart keeps its existing Plotly composition and typography; shared headline
and Bitcoin wordmark adoption remains pending.

## Historical observations and recovery

The producer reads Luke Dashjr's [history feed](https://luke.dashjr.org/programs/bitcoin/files/charts/data/history.txt).
Counts are source estimates sampled in UTC. `knots_count` includes BIP-110;
the dashboard and preview display non-BIP-110 Knots by subtracting
`bip110_count`. Missing historical counts remain missing, not zero.

The October 22, 2026, 11:06 p.m. EDT publication first imported a replacement
history: the series shrank from 3,227 to 540 rows and changed the overlapping observations, including
Knots on November 25, 2025 from 19,892 to 97,298. The recovery restores the
complete observations through October 22 from Git commit
`2320c0f393` (before `e4afbfcaefa0`, later amended to `da2eceb1fa`). This retains
the original timestamps, duplicate observations, and dated source gaps back
to April 27, 2017. Totals, Core-v30, and BIP-110 are restored together because
the upstream replacement affected those fields too.

All saved refs and reflogs were checked; October 23–24 have no intact
observations from before the upstream change.
Those new source samples are retained without estimation. The transition
between October 22 and 23 crosses source generations and should not be
interpreted solely as a real change in the network.

`webapp_data/bitcoin_node_history.csv` is now the published archive as well as
the chart payload. Normal updates retain every existing observation through
the latest published UTC day and append only later UTC days. This also
deliberately excludes later same-day samples and revisions until explicitly
reviewed. Matching raw timestamps is insufficient: the upstream replacement
also shifted collection seconds. A truncated or stale feed cannot shorten
the archive. Missing or malformed archive files fail the update.

The hourly producer reads the archive from the checkout even when
`NODE_COUNT_WEBAPP_DATA_DIR` points to a new staging directory. Deploy this
producer change together with the recovered data. `--history-archive PATH`
selects another baseline for an isolated run; it must be a complete, audited
CSV. No source values are smoothed or inferred by the reconciliation.

For an explicit recovery, first extract the audited baseline to a temporary
CSV, then use the producer's offline repair mode:

```bash
git show 2320c0f393:webapps/node_count/webapp_data/bitcoin_node_history.csv > /tmp/node-history-before-rewrite.csv
python3 webapps/node_count/node_count_webapp_data_update.py --repair-history-from /tmp/node-history-before-rewrite.csv
```

This validates the current publication, restores the audited rows, retains
published days after the baseline cutoff, rebuilds the blocks and weekly
tables, and writes real payload hashes and the publication marker last. It
preserves software/version artifacts and performs no network requests,
database access, commits, or deployment. Python needs pandas and requests.
For an isolated recovery, copy the existing `webapp_data` to a temporary
directory and set `NODE_COUNT_WEBAPP_DATA_DIR` to that copy.

Checks: `python3 -m unittest scripts.test_node_history_archive
scripts.test_node_count_producer` (producer tests require pandas/requests),
`python3 scripts/test_incremental_publication_markers.py`, and the Node Count
targets of `scripts/test_stage3_incremental_refresh.py` and
`scripts/test_homepage_preview_refresh.py`.
