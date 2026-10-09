// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MyToken is ERC20 {
    /// @notice 设置名称、符号，并把一百亿枚（18 位精度）一次铸给部署者。
    /// @dev 转账和授权沿用父合约 ERC20；本合约没有公开的追加铸币入口。
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        _mint(msg.sender, 10_000_000_000 * 1e18);
    }
}
