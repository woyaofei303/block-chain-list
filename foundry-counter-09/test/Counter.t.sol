// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    Counter public counter;

    /// @notice 每个测试各用一个从 0 开始的实例，避免上一项修改影响下一项。
    function setUp() public {
        counter = new Counter();
        counter.setNumber(0);
    }

    /// @notice 初始为 0 时加一次得到 1，验证自增会写回合约状态。
    function test_Increment() public {
        counter.increment();
        assertEq(counter.number(), 1);
    }

    /// @notice Forge 自动提供不同的 x，逐个检查设置后读出的值仍等于输入。
    function testFuzz_SetNumber(uint256 x) public {
        counter.setNumber(x);
        assertEq(counter.number(), x);
    }
}
