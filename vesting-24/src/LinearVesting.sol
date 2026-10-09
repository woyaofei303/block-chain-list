// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title LinearVesting
/// @notice 12 个月 Cliff 后，分 24 个完整月解锁一笔固定 ERC20 配额。
contract LinearVesting {
    using SafeERC20 for IERC20;

    /// @notice 教学约定：一个月固定为 30 天，不按自然月计算。
    uint256 public constant MONTH = 30 days;
    /// @notice 部署后前 12 个月没有任何可释放额度。
    uint256 public constant CLIFF_DURATION = 12 * MONTH;
    /// @notice Cliff 结束后 24 个月内完成全部释放。
    uint256 public constant VESTING_DURATION = 24 * MONTH;

    /// @notice 释放接收地址，部署后不可修改。
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable beneficiary;
    /// @notice 被锁定的 ERC20 合约，部署后不可修改。
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    IERC20 public immutable token;
    /// @notice 本次 Vesting 的固定总配额。
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable totalAllocation;
    /// @notice Vesting 部署区块的时间戳，Cliff 从此刻开始计算。
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable start;
    /// @notice 已经转给 beneficiary 的累计数量。
    uint256 public released;

    error InvalidParameters();

    /// @notice 记录一次实际释放。
    /// @param amount 本次转给 beneficiary 的 ERC20 数量。
    event Released(uint256 amount);

    /// @notice 创建 Vesting，并从当前区块开始计时；代币需由外部在部署后转入本合约。
    /// @param beneficiary_ 解锁代币的接收人，不能是零地址。
    /// @param token_ 被锁定的 ERC20 地址，必须已有合约代码。
    /// @param totalAllocation_ 计划释放的总数量，必须大于零。
    constructor(address beneficiary_, address token_, uint256 totalAllocation_) {
        if (beneficiary_ == address(0) || token_.code.length == 0 || totalAllocation_ == 0) {
            revert InvalidParameters();
        }

        beneficiary = beneficiary_;
        token = IERC20(token_);
        totalAllocation = totalAllocation_;
        start = block.timestamp;
    }

    /// @notice 计算指定时间点已解锁的累计数量，仅在整月边界增加。
    /// @param timestamp 要计算的时间戳。
    /// @return 已归属但不一定已经转出的累计数量。
    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        uint256 vestingStart = start + CLIFF_DURATION;
        if (timestamp < vestingStart) {
            return 0;
        }
        if (timestamp >= vestingStart + VESTING_DURATION) {
            return totalAllocation;
        }

        uint256 elapsedMonths = (timestamp - vestingStart) / MONTH;
        // 按累计比例只舍入一次，mulDiv 避免大配额的中间乘法溢出；最后一期归还全部尾差。
        return Math.mulDiv(totalAllocation, elapsedMonths, 24);
    }

    /// @notice 查询当前可由 release() 转给 beneficiary 的数量。
    /// @return 尚未释放的已归属数量。
    function releasable() public view returns (uint256) {
        uint256 vested = vestedAmount(block.timestamp);
        return vested > released ? vested - released : 0;
    }

    /// @notice 将当前已归属且未释放的 ERC20 转给 beneficiary。
    /// @dev 任何地址都可以触发转账，资金始终只会转给固定 beneficiary；状态先更新再外部调用。
    function release() external {
        uint256 amount = releasable();
        if (amount == 0) {
            return;
        }

        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit Released(amount);
    }
}
