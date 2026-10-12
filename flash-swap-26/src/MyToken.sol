// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 两次部署此合约得到 TokenA、TokenB；无转账税、无重基准、无额外铸币入口。
contract MyToken is ERC20 {
    /// @notice 将固定 100 万枚、18 位精度的代币发给部署者；名称与符号用于区分两种币。
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 1_000_000 ether);
    }
}
