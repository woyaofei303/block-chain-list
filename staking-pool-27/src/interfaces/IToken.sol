// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice 题面 KK 接口；配套实现使用 18 位精度，并限制铸币调用者。
interface IToken is IERC20 {
    /// @notice 向 to 铸造 amount 个最小单位；调用者必须拥有实现合约的铸币权限。
    function mint(address to, uint256 amount) external;
}
