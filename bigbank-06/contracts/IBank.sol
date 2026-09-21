// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Admin 只依赖提款能力；实现此接口的合约自行负责权限检查和 ETH 转账。
interface IBank {
    function withdraw() external;
}
