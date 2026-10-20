// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice DAO 的 ETH 公共金库；转入资金不产生个人可提余额，管理员固定为部署时指定的 Gov。
contract Bank {
    address public immutable admin;

    error Unauthorized(address caller);
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientBalance();
    error TransferFailed();

    event Deposited(address indexed sender, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

    /// @notice 固定唯一管理员，拒绝零地址；部署脚本直接传 Gov，不保留部署者后门。
    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidAddress();
        admin = admin_;
    }

    /// @notice 任意地址可向公共金库转入 ETH；仅记录事件，不创建个人提款权。
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice 仅管理员可向非零接收方支付正数 wei；余额不足或接收方拒收时整体回滚。
    function withdraw(address payable recipient, uint256 amount) external {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > address(this).balance) revert InsufficientBalance();
        // Gov 在外部调用前标记提案已执行；转账失败会连同该标记一起回滚。
        emit Withdrawn(recipient, amount);
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert TransferFailed();
    }
}
