// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;

    event NumberChanged22(uint256 oldNumber, uint256 newNumber);

    function setNumber(uint256 newNumber) public {
        emit NumberChanged22(number, newNumber);
        number = newNumber;
    }

    function increment() public {
        emit NumberChanged22(number, number + 1);
        number++;
    }
}
