// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice 固定发行的治理代币；持有人需委托自己或代表，余额才成为可用票权。
contract GovToken is ERC20Votes {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 ether;

    /// @notice 向初始持有人发行全部 GTK；零地址会被 ERC20 拒绝，不提供后续增发入口。
    constructor(address initialHolder) ERC20("Governance Token", "GTK") EIP712("Governance Token", "1") {
        _mint(initialHolder, INITIAL_SUPPLY);
    }
}
