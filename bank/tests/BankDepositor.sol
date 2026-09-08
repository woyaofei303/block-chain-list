// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../contracts/Bank.sol";

// Separate callers make Bank observe distinct msg.sender addresses.
// Remix treats every contract in *_test.sol as a test suite, so keep this helper here.
contract BankDepositor {
    function deposit(Bank bank, bool direct) external payable {
        if (direct) {
            (bool success,) = address(bank).call{value: msg.value}("");
            require(success, "Direct deposit failed");
        } else {
            bank.deposit{value: msg.value}();
        }
    }

    function withdraw(Bank bank) external {
        bank.withdraw();
    }
}
