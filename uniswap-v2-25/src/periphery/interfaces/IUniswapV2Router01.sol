pragma solidity >=0.6.2;

interface IUniswapV2Router01 {
    /// @notice 读取绑定的 Factory 地址，用于查池、建池及核对工厂配置。
    function factory() external pure returns (address);
    /// @notice 读取 Router 绑定的 WETH 地址；ETH 相关入口会在这里包装或解包。
    function WETH() external pure returns (address);

    /// @notice 按池中比例转入两种代币并获得 LP；实际用量须分别达到用户设定的最低值。
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    /// @notice 把 ETH 包装为 WETH 后与 Token 加池；多余的 ETH 退回调用者。
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
    /// @notice 从用户代扣 LP 并按份额取回两种资产；两种到账量均须满足最低要求。
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);
    /// @notice 交回 Token/WETH 池的 LP，取出 Token 并把 WETH 解包为 ETH。
    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH);
    /// @notice 先用 LP 持有人的签名授权 Router，再移除流动性；签名不替代资产本身。
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 amountA, uint256 amountB);
    /// @notice 通过 LP Permit 授权取回 Token 和 ETH，仍检查期限与最低取回量。
    function removeLiquidityETHWithPermit(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 amountToken, uint256 amountETH);
    /// @notice 固定输入多少 Token，沿 path 兑换；最终输出少于 amountOutMin 时整笔回滚。
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    /// @notice 固定想拿到多少 Token，反推需要的输入；不得超过 amountInMax。
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    /// @notice 把附带的 ETH 全部包装后兑换，路径起点必须是 WETH，并检查最低输出。
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    /// @notice 固定想拿到的 ETH 数量，反推 Token 输入；路径终点须为 WETH，再解包付款。
    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    /// @notice 固定 Token 输入，沿以 WETH 结尾的路径兑换并解包；检查最低 ETH 输出。
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    /// @notice 固定 Token 输出，只使用所需的 ETH，剩余 ETH 退回调用者。
    function swapETHForExactTokens(uint256 amountOut, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    /// @notice 仅按两种储备比例计算配比，不计手续费和兑换产生的价格变化。
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256 amountB);
    /// @notice 从固定输入计算扣除 0.3% 手续费后的输出，按最小单位向下取整。
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        returns (uint256 amountOut);
    /// @notice 从固定输出反推足够的输入，增加一个最小单位避免整数除法导致少付。
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        returns (uint256 amountIn);
    /// @notice 沿 path 逐池向前计算每一步输出；返回数组与路径地址一一对应。
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    /// @notice 沿 path 从目标输出向后反推各步输入，供固定输出的兑换使用。
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}
