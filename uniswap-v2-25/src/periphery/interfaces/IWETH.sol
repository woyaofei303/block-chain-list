pragma solidity >=0.5.0;

interface IWETH {
    /// @notice 把本次附带的 ETH 一比一包装成调用者的 WETH 余额。
    function deposit() external payable;
    /// @notice 从调用者余额向 to 转币；资金来自调用者，不来自授权账户。
    function transfer(address to, uint256 value) external returns (bool);
    /// @notice 销毁调用者指定数量的 WETH，并返还相同 Wei 数量的 ETH。
    function withdraw(uint256) external;
}
