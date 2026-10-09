pragma solidity >=0.5.0;

interface IUniswapV2ERC20 {
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
}
