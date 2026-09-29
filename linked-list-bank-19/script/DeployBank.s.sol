// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

interface DeployVm {
    /// @notice 后续创建交易使用 forge script 指定的发送者。
    function startBroadcast() external;
    /// @notice 停止收集交易；只有命令行传入 --broadcast 才真正发送。
    function stopBroadcast() external;
}

contract DeployBank {
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice 部署 Bank，交易发送者成为管理员；默认模拟，本地广播使用 Anvil 解锁账户。
    /// @return bank 新创建的 Bank，地址可从脚本输出或广播记录取得。
    function run() external returns (Bank bank) {
        vm.startBroadcast();
        bank = new Bank();
        vm.stopBroadcast();
    }
}
