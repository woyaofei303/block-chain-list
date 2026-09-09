// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "./Bank.sol";

// 继承 Bank 的记账、排行榜与提款，只扩展存款门槛和管理员转移。
contract BigBank is Bank {
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier minimumDeposit() {
        require(msg.value > 0.001 ether, "Deposit must exceed 0.001 ether");
        _;
    }

    // 只能由当前管理员转移，零地址会永久失去提款权限，因此拒绝。
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // 两个继承入口都调用此函数，直接转账也不能绕过 modifier。
    function _deposit() internal override minimumDeposit {
        super._deposit();
    }
}
