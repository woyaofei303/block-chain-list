// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {MyToken} from "../src/MyToken.sol";

contract MyTokenScript is Script {
    function run(string memory name_, string memory symbol_) public returns (MyToken token) {
        vm.startBroadcast();
        token = new MyToken(name_, symbol_);
        vm.stopBroadcast();
    }
}
