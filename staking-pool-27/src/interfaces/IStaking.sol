// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice ETH 质押接口，ETH 金额均使用 wei，KK 收益使用代币最小单位。
interface IStaking {
    /// @notice 质押 msg.value ETH；不接受零金额。
    function stake() external payable;

    /// @notice 赎回 amount 本金；借贷版本同时返还对应份额的市场收益。
    function unstake(uint256 amount) external;

    /// @notice 领取已累计的 KK；本金已全部退出也可领取。
    function claim() external;

    /// @notice 查询 account 尚未赎回的 ETH 本金，不含借贷利息。
    function balanceOf(address account) external view returns (uint256);

    /// @notice 查询 account 截至当前区块待领取的 KK，不修改状态。
    function earned(address account) external view returns (uint256);
}
