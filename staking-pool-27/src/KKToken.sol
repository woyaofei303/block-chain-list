// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IToken} from "./interfaces/IToken.sol";

/// @notice 18 位精度的 KK；部署脚本将唯一铸币权限转交给质押池。
contract KKToken is ERC20, Ownable, IToken {
    /// @notice 创建零初始供应的 KK；initialOwner 不能是零地址。
    constructor(address initialOwner) ERC20("KK Token", "KK") Ownable(initialOwner) {}

    /// @notice 仅 owner 可以铸币；交接给池后，用户只能通过 claim 获得奖励。
    function mint(address to, uint256 amount) external override onlyOwner {
        _mint(to, amount);
    }
}
