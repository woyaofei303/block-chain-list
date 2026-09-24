// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {JulianToken} from "../src/JulianToken.sol";
import {IdempotentTokenBank} from "../src/IdempotentTokenBank.sol";

contract DeploySepolia is Script {
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant DELEGATOR = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;

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
