// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice 本市场的固定供应支付 Token；18 位精度，支持标准 EIP-2612。
contract PermitToken is ERC20Permit {
    /// @notice 给部署者一次发行一百万 Token；Permit 域名与 Token 名称一致，版本为 1。
    constructor() ERC20("Merkle Market Token", "MMT") ERC20Permit("Merkle Market Token") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
