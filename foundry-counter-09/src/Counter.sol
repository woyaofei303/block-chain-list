// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;

    event NumberChanged22(uint256 oldNumber, uint256 newNumber);

    /// @notice 直接把数值设为 newNumber；事件同时留下修改前后的值。
    function setNumber(uint256 newNumber) public {
        emit NumberChanged22(number, newNumber);
        number = newNumber;
    }

    /// @notice 在当前值上加 1；溢出会回滚，前面的事件也不会留下。
    function increment() public {
        emit NumberChanged22(number, number + 1);
        number++;
    }
}
