// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 本地演示的 6 位精度支付币，不是真实 USDT，不提供开放增发。
contract MockUSDT is ERC20 {
    /// @notice 部署时一次性给测试用户分配固定数量，避免演示依赖外部水龙头。
    constructor(address recipient, uint256 amount) ERC20("Mock USDT", "mUSDT") {
        _mint(recipient, amount);
    }

    /// @notice 使用 6 位精度，使 2000 USDT 的行权价表示为 2000e6。
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
