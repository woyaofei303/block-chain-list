// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TokenBank {
    IERC20 public immutable token;
    mapping(address => uint256) public balances;

    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IERC20(tokenAddress);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        balances[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Amount must be positive");
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
    }
}
