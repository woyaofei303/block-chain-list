// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

// startBroadcast 会让其中产生的合约创建交易使用命令行指定的部署账户。
interface BankDeployVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice 部署 Bank。默认只模拟；命令行增加 --broadcast 后才发送到 Sepolia。
contract DeployBankScript {
    BankDeployVm private constant vm = BankDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // -vvvv 模拟输出会显示此事件中的部署地址和管理员地址。
    event BankDeployed(address indexed bank, address indexed admin);

    function run() external returns (Bank bank) {
        vm.startBroadcast();
        bank = new Bank();
        vm.stopBroadcast();

        // 部署交易的发送者自动成为 Bank 管理员。
        require(bank.admin() != address(0), "Bank admin was not set");
        emit BankDeployed(address(bank), bank.admin());
    }
}
