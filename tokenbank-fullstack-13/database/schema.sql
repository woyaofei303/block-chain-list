CREATE TABLE IF NOT EXISTS scan_progress (
  chain_id bigint NOT NULL,
  token_address text NOT NULL,
  start_block bigint NOT NULL,
  next_block bigint NOT NULL,
  block_hash text,
  PRIMARY KEY (chain_id, token_address)
);
CREATE TABLE IF NOT EXISTS transfers (
  chain_id bigint NOT NULL,
  token_address text NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  value_raw numeric(78, 0) NOT NULL CHECK (value_raw >= 0),
  PRIMARY KEY (chain_id, token_address, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS transfers_from
  ON transfers (chain_id, token_address, from_address, block_number DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS transfers_to
  ON transfers (chain_id, token_address, to_address, block_number DESC, log_index DESC);

-- 登录 nonce 和会话只用于确认钱包身份，不保存签名密钥。
CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce text PRIMARY KEY,
  address text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  address text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  account text NOT NULL,
  operation_id text NOT NULL,
  chain_id bigint NOT NULL,
  bank_address text NOT NULL,
  action text NOT NULL CHECK (action IN ('deposit', 'withdraw')),
  amount_raw numeric(78,0) NOT NULL CHECK (amount_raw > 0),
  payload_hash text NOT NULL,
  start_block bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_status text NOT NULL DEFAULT 'pending' CHECK (verified_status IN ('pending', 'confirmed', 'failed')),
  verified_transaction_hash text,
  verified_at timestamptz,
  PRIMARY KEY (account, operation_id)
);
CREATE TABLE IF NOT EXISTS operation_transactions (
  account text NOT NULL,
  operation_id text NOT NULL,
  transaction_hash text NOT NULL,
  PRIMARY KEY (account, operation_id, transaction_hash),
  FOREIGN KEY (account, operation_id) REFERENCES operations(account, operation_id)
);
