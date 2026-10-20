// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {GovToken} from "../src/GovToken.sol";
import {Gov} from "../src/Gov.sol";
import {Bank} from "../src/Bank.sol";

/// @notice 只部署本地教学 DAO，不代替成员分币、委托或投票。
contract Deploy is Script {
    /// @notice 按 Token → Gov → Bank 部署；初始币归命令行发送者，Bank 管理员直接是 Gov。
    function run() external returns (GovToken token, Gov gov, Bank bank) {
        require(block.chainid == 31337, "local chain only");
        vm.startBroadcast();
        token = new GovToken(msg.sender);
        gov = new Gov(token);
        bank = new Bank(address(gov));
        vm.stopBroadcast();
        require(bank.admin() == address(gov), "wrong bank admin");
        console2.log("GovToken", address(token));
        console2.log("Gov", address(gov));
        console2.log("Bank", address(bank));
    }
}
