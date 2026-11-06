-- Nothing reads `yahoo_resolved_at`, and the symbol cache does not write it.
update instrument set meta = meta - 'yahoo_resolved_at' where meta ? 'yahoo_resolved_at';
