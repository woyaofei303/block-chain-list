// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {MemeFactory} from "../src/MemeFactory.sol";

/// @notice 部署工厂及其共享实现；不加 --broadcast 时只模拟，不发送交易。
contract DeployMemeFactory is Script {
    function run() external returns (MemeFactory factory) {
        // 使用命令行指定的发送者/钱包，项目方收款地址是部署账户，不是脚本合约。
        // 脚本不读取私钥；本地 Anvil 可用 --sender 配合 --unlocked。
        vm.startBroadcast();
        factory = new MemeFactory();
        vm.stopBroadcast();
    }
}
