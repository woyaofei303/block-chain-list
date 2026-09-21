// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../contracts/BaseERC20.sol";
import "../contracts/TokenBank.sol";

// 让银行看到独立的用户地址，模拟第二位存款人。
contract TokenBankUser {
    function approve(BaseERC20 token, TokenBank bank, uint256 amount) external {
        token.approve(address(bank), amount);
    }

    function deposit(TokenBank bank, uint256 amount) external {
        bank.deposit(amount);
    }

    function withdraw(TokenBank bank, uint256 amount) external {
        bank.withdraw(amount);
    }
}

// 只用于验证银行如何处理 ERC20 返回 false，不作为实际代币使用。
contract SwitchableToken {
    bool public succeeds;

    function setSucceeds(bool value) external {
        succeeds = value;
    }

    function transfer(address, uint256) external view returns (bool) {
        return succeeds;
    }

    function transferFrom(address, address, uint256) external view returns (bool) {
        return succeeds;
    }
}
