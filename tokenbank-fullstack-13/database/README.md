# PostgreSQL 事件索引

新增请求与幂等闭环请先读 [REQUESTS.md](../REQUESTS.md)，其中说明新版银行、SIWE 会话、操作表、取消和恢复边界。

表结构由 [schema.sql](schema.sql) 唯一维护，后端启动时执行幂等建表。重复启动不会清空数据。无需新增 ORM、数据库服务容器或与链上账本重复的余额表。

- `scan_progress`：按 chain_id / token_address 保存起始块、下一扫描块和检查点哈希。
- `transfers`：保存区块、交易、日志序号、收发地址与最小单位金额。主键含链、Token、交易哈希与日志序号。
- `value_raw` 使用 `numeric(78,0)`，前后端使用 bigint / 十进制字符串，避免 uint256 精度丢失。
- `transfers_from` / `transfers_to` 支持按地址查询收支。

本目录管理数据库结构与核对 SQL；后端转账领域管理扫描事务和查询。钱包余额、个人可提余额、银行总资产由合约提供，不能通过修改索引数据改变它们。

从本项目根目录、在已经加载对应数据库配置的终端执行只读核对：

```bash
psql "$PGDATABASE" -v ON_ERROR_STOP=1 -f database/verify.sql
```

更换链实例或重建部署时使用新数据库。恢复已有链时继续使用同一状态文件、数据库和配置。测试只建立并清理随机 schema，不修改 public 中的复习记录。
