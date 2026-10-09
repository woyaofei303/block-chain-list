pragma solidity =0.5.16;

import "../core/UniswapV2ERC20.sol";

contract ERC20 is UniswapV2ERC20 {
    /// @notice 仅用于本地练习：一次性向部署者铸造指定总量；继承上游测试币的 UNI-V2 名称。
    constructor(uint256 _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}
