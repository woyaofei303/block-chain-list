// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract JulianToken is ERC20Permit {
    /// @notice 一次给部署者发行一百万 JUL；ERC20Permit 让持有人用签名设置代扣额度。
    constructor() ERC20("Julian Token", "JUL") ERC20Permit("Julian Token") {
        _mint(msg.sender, 1_000_000 ether);
    }
}
