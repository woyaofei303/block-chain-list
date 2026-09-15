// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// TokenBank 只需要 ERC-20 的两个转账接口，不引入完整依赖。
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice 用户存入同一个 ERC-20 Token，并取回自己的可提余额。
/// @dev 存款前用户必须先在 Token 合约中 approve TokenBank。
contract TokenBank {
    // 部署时确定唯一支持的 Token，之后不能替换。
    IERC20 public immutable token;

    // 用户地址 => 当前可提 Token 数量，即累计存入减去累计取出。
    // 这里与 Bank.deposits 的“历史累计值”语义不同。
    mapping(address => uint256) public balances;

    // tokenAddress 必须是已部署合约，避免把普通地址误当成 ERC-20。
    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IERC20(tokenAddress);
    }

    /// @notice 从调用者账户转入 amount，并增加调用者在 TokenBank 中的可提余额。
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be positive");

        // TokenBank 作为 spender 调用 transferFrom，会消耗用户事先授予的 allowance。
        // 只有 Token 实际转入成功后才增加内部余额，防止无资产记账。
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        balances[msg.sender] += amount;
    }

    /// @notice 取出调用者自己的 amount Token。
    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");

        // 先扣内部余额，再调用外部 Token，遵循 checks-effects-interactions。
        // 如果 transfer 返回 false，require 会回滚，刚才的扣账也会一起恢复。
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
    }
}
