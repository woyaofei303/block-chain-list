// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../contracts/Bank.sol";

// 每个辅助合约代表一位存款人，使 Bank 看到不同的 msg.sender。
// 若只在同一个测试合约里切换测试函数的调用者，Bank 看到的仍是测试合约地址。
// 单独放置：Remix 会将 *_test.sol 中的合约识别为测试套件。
contract BankDepositor {
    // direct=true 模拟无调用数据的直接转账；false 调用显式 deposit()。
    function deposit(Bank bank, bool direct) external payable {
        if (direct) {
            // 空字符串表示空调用数据，触发 Bank.receive()；原样转发本次金额。
            (bool success,) = address(bank).call{value: msg.value}("");
            require(success, "Direct deposit failed");
        } else {
            bank.deposit{value: msg.value}();
        }
    }

    // 通过辅助合约请求提款，验证非管理员会被 Bank 拒绝。
    function withdraw(Bank bank) external {
        bank.withdraw();
    }
}
