// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice 为本地部署和测试提供的 18 位 ERC20 示例代币。
contract VestingToken is ERC20 {
    /// @notice 铸造 200 万枚示例代币给部署者，部署者再将其中 100 万枚转入 Vesting。
    constructor() ERC20("Vesting Token", "VEST") {
        _mint(msg.sender, 2_000_000 ether);
    }
}
