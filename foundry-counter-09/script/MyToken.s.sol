// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {MyToken} from "../src/MyToken.sol";

contract MyTokenScript is Script {
    /// @notice 按传入名称与符号部署 Token，初始供应量归广播账户而非脚本合约。
    /// @dev 返回地址供查看；模拟得到的地址不能当成已经上链的部署结果。
    function run(string memory name_, string memory symbol_) public returns (MyToken token) {
        vm.startBroadcast();
        token = new MyToken(name_, symbol_);
        vm.stopBroadcast();
    }
}
