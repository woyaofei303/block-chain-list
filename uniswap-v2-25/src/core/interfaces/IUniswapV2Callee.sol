pragma solidity >=0.5.0;

interface IUniswapV2Callee {
    /// @notice 接收闪电兑换回调，必须在返回前归还足够资产；实现方应核对调用者是预期池。
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
