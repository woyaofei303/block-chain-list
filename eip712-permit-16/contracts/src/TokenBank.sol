// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice 用于本项目 BaseERC20，按无手续费、无 rebase 的代币记账。
contract TokenBank {
    // 部署时固定 Token 地址，之后不能更换。
    IERC20 public immutable token;
    // 当前可提余额 = 累计存入 - 累计提取，单位为 Token 最小单位。
    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IERC20(tokenAddress);
    }

    // 用户必须先在 Token 合约中 approve 本银行。
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        // Token 看到的调用者是银行，使用的是用户授权给银行的额度。
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        // 只能提取调用者自己的存款。
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");
        // 先扣账再转币；转账失败时扣账也会回滚。
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
