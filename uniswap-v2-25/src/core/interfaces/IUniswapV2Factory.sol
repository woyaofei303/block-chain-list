pragma solidity >=0.5.0;

interface IUniswapV2Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    /// @notice 读取协议手续费的接收地址；零地址表示关闭协议分成。
    function feeTo() external view returns (address);
    /// @notice 读取有权设置协议费接收地址及转移该权限的账户。
    function feeToSetter() external view returns (address);

    /// @notice 按两种代币查询池地址；两种输入顺序均可，尚未建池时返回零地址。
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    /// @notice 按从零开始的下标查询已建池地址；下标须小于池总数。
    function allPairs(uint256) external view returns (address pair);
    /// @notice 读取已创建池的数量，便于遍历 allPairs。
    function allPairsLength() external view returns (uint256);

    /// @notice 创建两种代币唯一的池并初始化；建池本身不会自动注入流动性。
    function createPair(address tokenA, address tokenB) external returns (address pair);

    /// @notice 仅 feeToSetter 可设置协议费接收人；不改变兑换的 0.3% 手续费规则。
    function setFeeTo(address) external;
    /// @notice 仅当前权限持有人可移交配置权，调用后原账户失去此权限。
    function setFeeToSetter(address) external;
}
