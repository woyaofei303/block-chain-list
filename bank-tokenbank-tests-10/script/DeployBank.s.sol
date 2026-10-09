// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

// startBroadcast 会让其中产生的合约创建交易使用命令行指定的部署账户。
interface BankDeployVm {
    /// @notice 开始记录使用命令行账户发送的部署操作；是否真发送仍由 --broadcast 决定。
    function startBroadcast() external;
    /// @notice 结束需要广播的操作范围，后面的状态检查只在脚本中执行。
    function stopBroadcast() external;
}

/// @notice 部署 Bank。默认只模拟；命令行增加 --broadcast 后才发送到 Sepolia。
contract DeployBankScript {
    BankDeployVm private constant vm = BankDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // -vvvv 模拟输出会显示此事件中的部署地址和管理员地址。
    event BankDeployed(address indexed bank, address indexed admin);

    /// @notice 部署银行并检查管理员已设置；实际广播账户成为管理员。
    function run() external returns (Bank bank) {
        vm.startBroadcast();
        bank = new Bank();
        vm.stopBroadcast();

        // 部署交易的发送者自动成为 Bank 管理员。
        require(bank.admin() != address(0), "Bank admin was not set");
        emit BankDeployed(address(bank), bank.admin());
    }
}
