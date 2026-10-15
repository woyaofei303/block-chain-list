// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {KKToken} from "../src/KKToken.sol";
import {StakingPool} from "../src/StakingPool.sol";
import {CompoundStakingPool} from "../src/CompoundStakingPool.sol";
import {ICEther} from "../src/interfaces/ICEther.sol";

/// @notice 部署一个池和其专属 KK；默认基础版，显式传 CETH 时部署借贷版。
contract Deploy is Script {
    /// @notice 只支持本地模拟链；无私钥，广播使用命令行指定的本地解锁账户。
    function run() external returns (KKToken token, StakingPool pool) {
        require(block.chainid == 31337, "local chain only");
        address market = vm.envOr("CETH", address(0));
        vm.startBroadcast();
        token = new KKToken(msg.sender);
        pool = market == address(0) ? new StakingPool(token) : new CompoundStakingPool(token, ICEther(market));
        token.transferOwnership(address(pool));
        vm.stopBroadcast();
        require(token.owner() == address(pool), "mint authority not assigned");
        console2.log("KKToken", address(token));
        console2.log("StakingPool", address(pool));
    }
}
