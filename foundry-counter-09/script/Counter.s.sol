// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Counter} from "../src/Counter.sol";

contract CounterScript is Script {
    Counter public counter;

    /// @notice 部署一个初始为 0 的计数器；不加 --broadcast 时只在模拟环境运行。
    /// @dev startBroadcast 标记需要发送的操作，实际发送者由 Forge 命令选择。
    function run() public {
        vm.startBroadcast();

        counter = new Counter();

        vm.stopBroadcast();
    }
}
