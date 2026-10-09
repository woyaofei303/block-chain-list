// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LinearVesting} from "../src/LinearVesting.sol";
import {VestingToken} from "../src/VestingToken.sol";

/// @notice 在本地链部署示例代币、Vesting，并把 100 万枚代币转入锁仓合约。
contract DeployVesting is Script {
    uint256 private constant TOTAL_ALLOCATION = 1_000_000 ether;

    /// @notice 使用 forge script 的发送者部署完整示例；不传 --broadcast 时只做模拟。
    /// @param beneficiary_ Vesting 的固定受益人地址。
    /// @return token 新部署的示例 ERC20。
    /// @return vesting 新部署的线性解锁合约。
    function run(address beneficiary_) external returns (VestingToken token, LinearVesting vesting) {
        vm.startBroadcast();
        token = new VestingToken();
        vesting = new LinearVesting(beneficiary_, address(token), TOTAL_ALLOCATION);
        require(token.transfer(address(vesting), TOTAL_ALLOCATION), "funding failed");
        vm.stopBroadcast();

        console2.log("VestingToken deployed at", address(token));
        console2.log("LinearVesting deployed at", address(vesting));
        console2.log("Beneficiary", beneficiary_);
        console2.log("Start timestamp", vesting.start());
    }
}
