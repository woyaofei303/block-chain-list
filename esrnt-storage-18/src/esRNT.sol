// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract esRNT {
    struct LockInfo {
        address user;
        uint64 startTime;
        uint256 amount;
    }

    // slot 0 保存数组长度；元素从 keccak256(abi.encode(uint256(0))) 开始。
    LockInfo[] private _locks;

    /// @notice 按题目初始化 11 项锁仓记录，不提供公开读取接口。
    /// @dev user 与 startTime 共用一个槽，amount 独占下一个槽。
    constructor() {
        for (uint256 i = 0; i < 11; i++) {
            // 修正原题 I 的大小写笔误；金额使用整数最小单位，保留原题公式。
            _locks.push(LockInfo(address(uint160(i + 1)), uint64(block.timestamp * 2 - i), 1e18 * (i + 1)));
        }
    }
}
