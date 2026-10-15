// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RebaseToken} from "../src/RebaseToken.sol";

/// @notice 部署 RBT 并将初始发行量分给命令行指定的本地发送者。
contract Deploy is Script {
    /// @notice 仅允许 chain ID 31337；默认模拟，显式 --broadcast 才向本地解锁账户广播。
    function run() external returns (RebaseToken token) {
        require(block.chainid == 31337, "local chain only");
        vm.startBroadcast();
        token = new RebaseToken();
        vm.stopBroadcast();
        // 刚部署的固定初始分配必须精确相等，这里不是外部可充值的资产余额门槛。
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(token.balanceOf(msg.sender) == token.INITIAL_SUPPLY(), "initial allocation mismatch");
        console2.log("RebaseToken", address(token));
    }
}
