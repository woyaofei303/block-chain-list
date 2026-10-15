// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Compound V2 原生 ETH 市场的最小接口，不需要 ERC20 approve。
interface ICEther {
    /// @notice 将 msg.value 存入市场，为调用者铸造 cETH；失败时回滚，没有返回值。
    function mint() external payable;

    /// @notice 销毁指定数量的 cETH 并返还 ETH；返回 0 才表示成功。
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice 查询 cETH 最小单位数量，不能把该数量当作 ETH wei。
    function balanceOf(address account) external view returns (uint256);
}
