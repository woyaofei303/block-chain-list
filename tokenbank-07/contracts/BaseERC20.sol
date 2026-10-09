// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice 先看 approve 如何登记额度，再看银行怎样通过 transferFrom 使用这份额度。
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

    /// @notice 部署时一次发行一亿枚给部署者；后续没有追加发行入口。
    constructor() {
        name = "BaseERC20";
        symbol = "BERC20";
        decimals = 18;
        // 固定发行一亿枚，全部分配给部署者。
        totalSupply = 100_000_000 * 10 ** 18;
        balances[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    /// @notice 查询地址持有的最小单位数；余额 10e18 表示 10 枚，而不是 10e18 枚。
    function balanceOf(address owner) public view returns (uint256) {
        return balances[owner];
    }

    /// @notice 从调用者自己的余额转出 value；不需要 approve，余额不足时回滚。
    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    /// @notice 把 spender 的可用额度设为 value；这一步只给权限，双方余额不变。
    function approve(address spender, uint256 value) public returns (bool) {
        require(spender != address(0), "ERC20: approve to the zero address");
        // 覆盖旧额度，不会实际转账；存款时 spender 应填银行地址。
        allowances[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    /// @notice 查询 spender 还能替 owner 转出多少；额度和 owner 的实际余额是两回事。
    function allowance(address owner, address spender) public view returns (uint256) {
        return allowances[owner][spender];
    }

    /// @notice 调用者使用 from 给自己的额度转币；余额与额度都够才会成功。
    /// @dev 例如 Alice 授权银行 10 枚，银行转走 4 枚后剩余额度为 6 枚。
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        // _transfer 无外部调用；后续授权检查失败时，余额和事件都会回滚。
        _transfer(from, to, value);
        require(allowances[from][msg.sender] >= value, "ERC20: transfer amount exceeds allowance");
        allowances[from][msg.sender] -= value;
        return true;
    }

    /// @dev 两种转账共用余额检查；只修改本代币账本，不调用收款合约。
    function _transfer(address from, address to, uint256 value) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balances[from] >= value, "ERC20: transfer amount exceeds balance");
        balances[from] -= value;
        balances[to] += value;
        emit Transfer(from, to, value);
    }
}
