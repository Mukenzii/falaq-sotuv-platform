-- The metric is called MML, not MLRR.
--
-- It was built as "MLRR" because that is what the first description called it;
-- the team's own word is MML, the same name as the must-list it measures. This
-- renames the view and its column. db/15 now creates v_mml directly, so on a
-- fresh database the drop below finds nothing and does nothing.
drop view if exists v_mlrr;
