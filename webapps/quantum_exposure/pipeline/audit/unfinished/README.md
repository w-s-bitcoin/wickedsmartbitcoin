# Unfinished replay verification

Archived at the maintainer's request on 2026-10-05, after Quantum processing was
paused. This folder preserves unfinished work, not a passing test or production
acceptance result. See the [public findings](../../../../../quantum_exposure_findings.html).

`test_quantum_v2_multi_snapshot_replay.py.txt` is the exact unreviewed source
previously at `scripts/test_quantum_v2_multi_snapshot_replay.py`. The `.txt`
extension keeps it out of executable test discovery. Its original docstring
describes the intended proof, **not an achieved result**. Its relative imports
assume the original `scripts/` location; this archived copy is not runnable in
place and is not registered in `check_project.sh`.

The already-running disposable fixture test finished after the stop request:

- Two tests ran. The independent synthetic oracle passed.
- The real PostgreSQL test failed at its first boundary: the durable request
  state was `analyzed`, while the assertion expected `complete`.
- No three-generation replay proof was achieved. No production publication was
  attempted by this test, and its disposable database was removed.
- The test and failure were preserved without fixing or rerunning the test.

Source SHA-256:
`3dd4f51e56ca089b790a1306c205aa052fd6fbf39b380e729c0e035962e2bc5d`.
Failed log SHA-256:
`22247465b5f4c77b3222ad58f553f7997cee606dd4a0c5146bbc9ab99674712f`.
Private preservation manifest SHA-256:
`b2cf077eaf711f980cd7fa29b14953d25da8b4d35f9fdaa560ae1dc7d47ecf5c`.

The failed log, wrapper, and raw operational report remain in the private
evidence archive. The source uses synthetic identities and contains no embedded
credentials. Resuming verification or the historical rebuild requires a renewed
maintainer request; the earlier implementation goal remains paused.
