# 固定版本的官方 Permit2

- Uniswap/permit2：`cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`，保留完整 `src/` 和 MIT `LICENSE`，源码未修改。
- 上游固定的 Solmate：`8d910d876f51c3b2585c9109409d601f600e68e1`，仅保留所需 `ERC20.sol`、`SafeTransferLib.sol` 与 `LICENSE`。
- Permit2 源文件已按 GitHub API 的 Git blob SHA-1 核对；Solmate 从上述固定提交归档取出。上游：[Permit2](https://github.com/Uniswap/permit2/tree/cc56ad0f3439c502c246fc5cfcc3db92bb8b7219)、[Solmate](https://github.com/transmissions11/solmate/tree/8d910d876f51c3b2585c9109409d601f600e68e1)。
- 本地 `foundry.toml` 单独编译官方 Solidity 0.8.17 / London / via-IR，沿用上游优化参数；银行仍使用 0.8.24 / Cancun。不是 Git 子模块，不需要 `forge install`。

从 `eip712-permit-16` 运行，先生成官方部署字节码，再执行银行测试：

```bash
forge build --root contracts/lib/permit2
forge test --root contracts
```

本地必须实际部署这个完整的 `Permit2` 合约，再把部署地址传给银行；不把公共链固定地址当成本机部署，也不使用 mock 或 `anvil_setCode` 替代部署。
