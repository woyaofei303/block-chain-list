// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice 所有人共用一个计数器：Alice 加 5 后，Bob 读取到的也是 5。
contract Counter {
    uint256 public counter;

    /// @notice 读取当前值；通过 RPC 查询不会修改状态，也不需要发送交易。
    function get() external view returns (uint256) {
        return counter;
    }

    /// @notice 在原值上累加 x，允许加 0；没有管理员限制。
    /// @dev uint256 装不下结果时整笔回滚，原值保留，不会绕回 0。
    function add(uint256 x) external {
        counter += x;
    }
}
