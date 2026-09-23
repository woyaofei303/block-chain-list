BEGIN READ ONLY;

SELECT chain_id, token_address, start_block, next_block,
       next_block - 1 AS indexed_through, block_hash
FROM scan_progress
ORDER BY chain_id, token_address;

SELECT chain_id, token_address, block_number, transaction_hash,
       log_index, from_address, to_address, value_raw::text
FROM transfers
ORDER BY block_number DESC, log_index DESC
LIMIT 100;

SELECT chain_id, token_address, transaction_hash, log_index, COUNT(*)
FROM transfers
GROUP BY chain_id, token_address, transaction_hash, log_index
HAVING COUNT(*) > 1;

COMMIT;
