// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {esRNT} from "../src/esRNT.sol";

interface DeployVm {
    /// @notice 让后续创建交易使用 forge script 指定的发送者。
    function startBroadcast() external;
    /// @notice 结束交易收集；是否真正发送由 --broadcast 决定。
    function stopBroadcast() external;
}

contract Deploy {
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice 部署题目合约并返回地址；默认模拟，本地广播使用 Anvil 解锁账户。
    /// @return deployed 新创建的 esRNT 合约。
    function run() external returns (esRNT deployed) {
        vm.startBroadcast();
        deployed = new esRNT();
        vm.stopBroadcast();
    }
}
