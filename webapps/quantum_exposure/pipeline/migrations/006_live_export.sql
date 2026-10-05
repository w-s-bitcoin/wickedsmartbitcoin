-- Canonical state retains retired families/groups for disclosure and activity
-- history. Routine exports first enumerate live groups through this index,
-- then fetch all their families from the existing (group_id,script_type) PK.
-- Include zero-satoshi outputs: liveness is the UTXO count, not the balance.
CREATE INDEX group_state_live_group_id ON quantum_v2.group_state(group_id)
  WHERE utxo_count > 0;

-- These validated invariants let accounting comparison omit wholly retired
-- rows without concealing an impossible positive balance with zero UTXOs.
-- A positive UTXO count may still carry zero satoshis.
ALTER TABLE quantum_v2.group_state
  ADD CONSTRAINT group_state_zero_utxo_balance CHECK (utxo_count > 0 OR balance_sats = 0),
  ADD CONSTRAINT group_state_zero_eligible_balance CHECK (eligible_utxos > 0 OR eligible_sats = 0);
