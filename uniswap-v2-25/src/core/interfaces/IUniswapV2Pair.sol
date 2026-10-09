pragma solidity >=0.5.0;

interface IUniswapV2Pair {
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice 读取代币名称，只供展示；识别资产仍须使用合约地址。
    function name() external pure returns (string memory);
    /// @notice 读取代币符号；不同合约可以使用同一符号。
    function symbol() external pure returns (string memory);
    /// @notice 读取显示精度，原始余额与转账参数仍是整数最小单位。
    function decimals() external pure returns (uint8);
    /// @notice 读取已发行总量；对 LP 代币而言，这是全部流动性份额的数量。
    function totalSupply() external view returns (uint256);
    /// @notice 读取 owner 的代币或 LP 份额余额，不是池子中的两种储备。
    function balanceOf(address owner) external view returns (uint256);
    /// @notice 读取 spender 还能替 owner 转走的额度；授权本身不转移余额。
    function allowance(address owner, address spender) external view returns (uint256);

    /// @notice 把调用者给 spender 的额度设为 value，覆盖原值；随后才可代扣。
    function approve(address spender, uint256 value) external returns (bool);
    /// @notice 从调用者余额向 to 转币；资金来自调用者，不来自授权账户。
    function transfer(address to, uint256 value) external returns (bool);
    /// @notice 使用 from 给调用者的额度转币，余额和授权都须足够。
    function transferFrom(address from, address to, uint256 value) external returns (bool);

    /// @notice 读取 Permit 的签名域，隔离不同链和不同 LP 合约，防止跨环境重放。
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    /// @notice 读取 Permit 结构的固定类型哈希，签名字段与次序必须匹配。
    function PERMIT_TYPEHASH() external pure returns (bytes32);
    /// @notice 读取 owner 下一次 Permit 使用的编号；成功授权后旧编号失效。
    function nonces(address owner) external view returns (uint256);

    /// @notice 验证持有人签名并设置 LP 代扣额度；这一步只授权，尚未取回池中资产。
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    /// @notice 首次加池永久锁住的最小 LP 单位数；不等于每次存款的最小金额。
    function MINIMUM_LIQUIDITY() external pure returns (uint256);
    /// @notice 读取绑定的 Factory 地址，用于查池、建池及核对工厂配置。
    function factory() external view returns (address);
    /// @notice 读取按地址大小排序后的第一种资产，不能按页面输入顺序假定。
    function token0() external view returns (address);
    /// @notice 读取排序后的第二种资产；与 reserve1 对应。
    function token1() external view returns (address);
    /// @notice 读取上次更新的两种储备和时间；直接转币后的实际余额可能更大。
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    /// @notice 读取 token0 价格的时间累计值，用于计算跨时段均价，不是当前兑换报价。
    function price0CumulativeLast() external view returns (uint256);
    /// @notice 读取反向价格的时间累计值；计算均价还需两次采样的时间差。
    function price1CumulativeLast() external view returns (uint256);
    /// @notice 读取上次流动性事件留下的储备乘积，供协议分成计算参考。
    function kLast() external view returns (uint256);

    /// @notice 按刚转进池的两种资产铸造 LP 给 to；须先转币，不能只调用 mint。
    function mint(address to) external returns (uint256 liquidity);
    /// @notice 销毁已经转到池地址的 LP，把对应两种资产发给 to；调用前须先交回 LP。
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    /// @notice 先发出指定数量，再检查实际输入与恒定乘积；data 非空时会调用接收方回调。
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    /// @notice 把实际余额超出已记储备的部分转给 to，不修改储备记录。
    function skim(address to) external;
    /// @notice 把实际余额写为储备；用于对齐直接转币后的状态，不向调用者付款。
    function sync() external;

    /// @notice 由 Factory 设置两种资产；只能在工厂控制的建池流程中调用。
    function initialize(address, address) external;
}
