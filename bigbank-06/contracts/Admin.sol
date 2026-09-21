// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBank} from "./IBank.sol";

// owner 是控制此合约的部署者；BigBank 的 admin 则设置为本合约地址。
contract Admin {
    /// @notice 只有 Admin 的部署者可以发起提款。
    error OnlyOwner();

    address public immutable owner;

    event Received(address indexed sender, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    // 接收 Bank.withdraw() 转来的 ETH，资金保留在 Admin 合约中。
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function adminWithdraw(IBank bank) external {
        if (msg.sender != owner) {
            revert OnlyOwner();
        }
        // 通过接口调用；目标合约看到的 msg.sender 是 Admin，而不是外层的钱包。
        bank.withdraw();
    }
}
