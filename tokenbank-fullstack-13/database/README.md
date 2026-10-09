# 数据库：保存历史与操作线索，不替代链上余额

一次 10 BERC20 存款会同时留下几种数据：合约余额发生变化，Transfer 事件被索引，用户的操作编号被记录。数据库负责后两者，不能通过改数据库让银行多出代币。

表结构只有 [schema.sql](schema.sql) 一个维护入口，后端启动时幂等建表；重复启动不会清空数据。先按 [操作指南](../WALKTHROUGH.md) 创建本轮独立数据库。

## 顺着一笔存款认识表

1. `auth_challenges` 保存一次性登录 nonce，`auth_sessions` 保存会话令牌哈希与有效期，证明接口调用者是谁。
2. `operations` 保存账户、operationId、银行、动作、精确金额与最近核实状态。
3. `operation_transactions` 保存该操作关联的交易哈希线索；线索存在不等于链上成功。
4. `transfers` 保存 Token 的实际转账日志。
5. `scan_progress` 保存下次从哪个区块开始，以及检查点哈希。

本项目使用普通 approve 后存款。 三种余额仍分别从 Token 和银行合约读取，没有一张可直接修改的“用户真实余额表”。

## 用重复扫描理解唯一键和事务

假设区块 100 的同一笔交易有日志序号 2、3。它们是两条记录；重扫时要各保留一次，而不是只按交易哈希留下第一条。

`transfers` 的主键是链、Token、交易哈希、日志序号。事件和 next_block 在同一事务提交；写到一半失败则一起撤销，不能出现“进度到了 110，100～109 的事件却没存全”。

`operations` 则按账户和 operationId 唯一。同一操作改金额属于冲突，不应该覆盖旧请求。最近 verified_status 是历史核实结果，服务端再次查询仍需检查规范链。

## 为什么金额是 numeric(78,0)

uint256 最大值有 78 位十进制数字。数据库用精确整数 numeric 保存；程序计算用 bigint，对外 JSON 用字符串。18 位代币的 10 枚是 `10000000000000000000`，JavaScript Number 不能保证任意大整数精确。

## 只读核对一次结果

从项目根目录、加载本轮 PostgreSQL 配置的终端执行：

```bash
psql "$PGDATABASE" -v ON_ERROR_STOP=1 -f database/verify.sql
```

也可在连接了同一数据库的 psql 中执行完整查询：

```sql
SELECT chain_id, token_address, start_block, next_block, block_hash
FROM scan_progress;

SELECT block_number, transaction_hash, log_index,
       from_address, to_address, value_raw
FROM transfers
ORDER BY block_number DESC, log_index DESC
LIMIT 10;

SELECT account, operation_id, action, amount_raw, verified_status
FROM operations
ORDER BY created_at DESC
LIMIT 10;
```

先核对 chain、Token 和操作账户，再比较金额。查出旧 confirmed 不足以证明当前链未重组；不要用 UPDATE 手工把 pending 改成成功。

## 恢复与测试边界

旧链状态、配置和数据库要成组保留。相同 chain ID 的全新 Anvil 不继承旧余额，换链实例时使用新数据库；只有数据库无法恢复链上资产。

测试创建并清理自己的随机 schema，不清理 public 中的学习数据。2026-10-09 已通过临时 schema 上的索引、操作登记和完整集成测试；没有修改 public 中的学习数据。
