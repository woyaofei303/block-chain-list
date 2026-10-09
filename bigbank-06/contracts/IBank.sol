// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Admin 只依赖提款能力；实现此接口的合约自行负责权限检查和 ETH 转账。
interface IBank {
    /// @notice 请求目标银行提款；接口只约定调用形状，权限由目标实现检查。
    function withdraw() external;
}
