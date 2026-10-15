// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 初始发行 1 亿枚，任何人可在完整年度结束后触发每年 1% 的通缩。
/// @dev 复用 ERC20 授权与入口校验，用固定份额替换父合约的余额和总量账本。
contract RebaseToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 100_000_000 ether;
    uint256 public constant YEAR = 365 days;

    // 选取能整除初始发行量的最大份额总量，使初始兑换精确、后续舍入误差极小。
    uint256 private constant TOTAL_SHARES = type(uint256).max - (type(uint256).max % INITIAL_SUPPLY);
    mapping(address account => uint256) private _shares;
    uint256 private _supply = INITIAL_SUPPLY;
    uint256 private _sharesPerUnit = TOTAL_SHARES / INITIAL_SUPPLY;
    uint256 public lastRebaseTime;

    error RebaseTooEarly();

    event Rebased(uint256 elapsedYears, uint256 previousSupply, uint256 newSupply);

    /// @notice 全部初始份额分给部署者，以部署时间作为年度起点；没有后续增发入口。
    constructor() ERC20("Rebase Token", "RBT") {
        _shares[msg.sender] = TOTAL_SHARES;
        lastRebaseTime = block.timestamp;
        emit Transfer(address(0), msg.sender, INITIAL_SUPPLY);
    }

    /// @notice 返回最近一次 rebase 后的发行量，单位为 10^-18 RBT。
    function totalSupply() public view override returns (uint256) {
        return _supply;
    }

    /// @notice 用当前比例换算账户余额并向下取整；时间流逝本身不会触发通缩。
    function balanceOf(address account) public view override returns (uint256) {
        return _supply == 0 ? 0 : _shares[account] / _sharesPerUnit;
    }

    /// @notice 补算全部完整年份，每年在上一年总量上缩减 1%；不足一年时回滚。
    /// @dev 任何人可调用；仅按年份循环，不遍历持有人。整数总量归零后停止计算。
    /// @return newSupply 本次通缩后的总量，以 Token 最小单位表示。
    function rebase() external returns (uint256 newSupply) {
        uint256 elapsedYears = (block.timestamp - lastRebaseTime) / YEAR;
        // 年度边界本来就以链上时间为准，不把时间戳用作随机数。
        // forge-lint: disable-next-line(block-timestamp)
        if (elapsedYears == 0) revert RebaseTooEarly();

        uint256 previousSupply = _supply;
        newSupply = previousSupply;
        // forge-lint: disable-next-line(block-timestamp)
        for (uint256 i = 0; i < elapsedYears && newSupply != 0; ++i) {
            newSupply = newSupply * 99 / 100;
        }

        _supply = newSupply;
        _sharesPerUnit = newSupply == 0 ? 0 : TOTAL_SHARES / newSupply;
        // 保留不足一年的余数；不能直接设为当前时间，否则延迟调用会推迟下一次周年。
        // forge-lint: disable-next-line(divide-before-multiply)
        lastRebaseTime += elapsedYears * YEAR;
        emit Rebased(elapsedYears, previousSupply, newSupply);
    }

    /// @notice 转账按当前比例移动份额，支持零额和自转账；禁止额外增发或单独销毁。
    /// @dev transfer/transferFrom 共用此入口，授权仍按 Token 数量计量，不随 rebase 缩放。
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0)) revert ERC20InvalidSender(address(0));
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));

        uint256 fromBalance = balanceOf(from);
        if (value > fromBalance) revert ERC20InsufficientBalance(from, fromBalance, value);
        // 先检查可见余额，使乘积不超过发送者份额，避免巨大输入引发乘法溢出。
        uint256 shares = value * _sharesPerUnit;
        _shares[from] -= shares;
        _shares[to] += shares;
        emit Transfer(from, to, value);
    }
}
