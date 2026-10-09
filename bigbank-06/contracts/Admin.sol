// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBank} from "./IBank.sol";

// owner 是控制此合约的部署者；BigBank 的 admin 则设置为本合约地址。
contract Admin {
    /// @notice 只有 Admin 的部署者可以发起提款。
    error OnlyOwner();

    address public immutable owner;

    event Received(address indexed sender, uint256 amount);

    /// @notice 记住创建 Admin 的账户；它能发起提款，但收到的钱仍留在 Admin 中。
    constructor() {
        owner = msg.sender;
    }

    /// @notice 接收 Bank.withdraw() 转来的 ETH；本合约没有再把钱转给 owner 的入口。
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @notice owner 请 Admin 代为调用银行提款；银行须已把管理员设为本合约。
    /// @dev owner → Admin → Bank 是两次调用；任一步拒绝都会回滚本次操作。
    function adminWithdraw(IBank bank) external {
        if (msg.sender != owner) {
            revert OnlyOwner();
        }
        // 通过接口调用；目标合约看到的 msg.sender 是 Admin，而不是外层的钱包。
        bank.withdraw();
    }
}
