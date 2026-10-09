// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {JulianToken} from "../src/JulianToken.sol";
import {IdempotentTokenBank} from "../src/IdempotentTokenBank.sol";

contract DeploySepolia is Script {
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant DELEGATOR = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;

    /// @notice 仅在 Sepolia 创建 Token 和银行；先确认依赖存在，两个部署按此顺序使用 deployer。
    /// 此处不升级用户的 EIP-7702 账户；未传 --broadcast 的 Forge 执行只是模拟。
    function run(address deployer) external returns (JulianToken token, IdempotentTokenBank bank) {
        require(block.chainid == 11155111, "Sepolia only");
        require(deployer != address(0), "Invalid deployer");
        require(PERMIT2.code.length > 0, "Permit2 not deployed");
        require(DELEGATOR.code.length > 0, "Delegator not deployed");

        vm.startBroadcast(deployer);
        token = new JulianToken();
        bank = new IdempotentTokenBank(address(token), PERMIT2);
        vm.stopBroadcast();

        console2.log("Deployer:", deployer);
        console2.log("JulianToken:", address(token));
        console2.log("IdempotentTokenBank:", address(bank));
        console2.log("Permit2:", PERMIT2);
        console2.log("Delegator:", DELEGATOR);
    }
}
