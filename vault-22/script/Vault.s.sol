// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Script.sol";

import "../src/Vault.sol";

contract VaultScript is Script {
    /// @notice 按逻辑合约、Vault、初始存款的顺序部署；不加 --broadcast 时只模拟。
    /// @dev 发送者由 Forge CLI 的 --sender/--unlocked 或外部签名账户提供，脚本不保存密钥。
    function run() external {
        vm.startBroadcast();
        VaultLogic logic = new VaultLogic(bytes32("0x1234"));
        Vault vault = new Vault(address(logic));
        console2.log("VaultLogic deployed at", address(logic));
        console2.log("Vault deployed at", address(vault));
        vault.deposite{value: 0.1 ether}();
        vm.stopBroadcast();
    }
}
