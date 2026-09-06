// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Counter {
    uint256 public counter;

    function get() external view returns (uint256) {
        return counter;
    }

    function add(uint256 x) external {
        counter += x;
    }
}
