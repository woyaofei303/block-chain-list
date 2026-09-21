// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract BaseERC20 {
    // 金额均为最小单位：1 枚 Token = 10 ** 18 个最小单位。
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) private balances;
    // 所有者 => 被授权地址 => 剩余额度。
    mapping(address => mapping(address => uint256)) private allowances;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        name = "BaseERC20";
        symbol = "BERC20";
        decimals = 18;
        // 固定发行一亿枚，全部分配给部署者。
        totalSupply = 100_000_000 * 10 ** 18;
        balances[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function balanceOf(address owner) public view returns (uint256) {
        return balances[owner];
    }

    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        require(spender != address(0), "ERC20: approve to the zero address");
        // 覆盖旧额度，不会实际转账；存款时 spender 应填银行地址。
        allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        // _transfer 无外部调用；后续授权检查失败时，余额和事件都会回滚。
        _transfer(from, to, value);
        require(allowances[from][msg.sender] >= value, "ERC20: transfer amount exceeds allowance");
        allowances[from][msg.sender] -= value;
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balances[from] >= value, "ERC20: transfer amount exceeds balance");
        balances[from] -= value;
        balances[to] += value;
        emit Transfer(from, to, value);
    }
}
