// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../contracts/BaseERC20.sol";
import "../contracts/TokenBank.sol";

// 让银行看到独立的用户地址，模拟第二位存款人。
contract TokenBankUser {
    /// @notice 以独立存款人的身份授权指定银行。
    function approve(BaseERC20 token, TokenBank bank, uint256 amount) external {
        token.approve(address(bank), amount);
    }

    /// @notice 使用此前授权存入金额，沿用银行的金额检查。
    function deposit(TokenBank bank, uint256 amount) external {
        bank.deposit(amount);
    }

    /// @notice 只能提取本辅助合约名下的存款。
    function withdraw(TokenBank bank, uint256 amount) external {
        bank.withdraw(amount);
    }

    /// @notice 以独立合约身份模拟已授权 Receiver 调用自动半额划转。
    function withdrawhalf(TokenBank bank, address recipient) external {
        bank.withdrawhalf(recipient);
    }
}

// 只用于验证银行如何处理 ERC20 返回 false，不作为实际代币使用。
contract SwitchableToken {
    bool public succeeds;

    /// @notice 切换 Token 调用结果，测试失败回滚，不表示真实资产转移。
    function setSucceeds(bool value) external {
        succeeds = value;
    }

    /// @notice 返回设定结果，模拟提款成功或 ERC20 返回 false。
    function transfer(address, uint256) external view returns (bool) {
        return succeeds;
    }

    /// @notice 返回设定结果，模拟存款成功或 ERC20 返回 false。
    function transferFrom(address, address, uint256) external view returns (bool) {
        return succeeds;
    }
}
