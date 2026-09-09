// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "./Bank.sol";

// owner 是控制此合约的部署者；BigBank 的 admin 则设置为本合约地址。
contract Admin {
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    // 接收 Bank.withdraw() 转来的 ETH，资金保留在 Admin 合约中。
    receive() external payable {}

    function adminWithdraw(Bank bank) external {
        require(msg.sender == owner, "Only owner");
        // Bank 看到的 msg.sender 是本 Admin 合约，而不是外层的钱包。
        bank.withdraw();
    }
}
