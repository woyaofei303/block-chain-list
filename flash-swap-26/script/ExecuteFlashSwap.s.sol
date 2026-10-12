// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlashSwap} from "../src/FlashSwap.sol";

/// @notice 对已部署合约执行一笔闪电兑换并输出资产变化；不重复部署或补充流动性。
contract ExecuteFlashSwap is Script {
    /// @notice FLASH_SWAP 必填；借款默认 100 A、最低利润默认 90 B，均使用 18 位最小单位。
    function run() external {
        require(block.chainid == 31337 || block.chainid == 11155111, "unsupported chain");
        FlashSwap arb = FlashSwap(vm.envAddress("FLASH_SWAP"));
        require(arb.owner() == msg.sender, "sender is not owner");
        uint256 amountA = vm.envOr("BORROW_A", uint256(100 ether));
        uint256 minProfitB = vm.envOr("MIN_PROFIT_B", uint256(90 ether));
        (uint256 repayB, uint256 receivedB) = arb.quote(amountA);
        uint256 beforeB = arb.tokenB().balanceOf(msg.sender);
        vm.startBroadcast();
        arb.execute(amountA, minProfitB, block.timestamp + 600);
        vm.stopBroadcast();
        uint256 afterB = arb.tokenB().balanceOf(msg.sender);
        require(afterB > beforeB && afterB - beforeB >= minProfitB, "profit check failed");
        console2.log("Chain ID", block.chainid);
        console2.log("FlashSwap", address(arb));
        console2.log("Borrowed A", amountA);
        console2.log("Received B", receivedB);
        console2.log("Repaid B", repayB);
        console2.log("Owner B before", beforeB);
        console2.log("Owner B after", afterB);
        console2.log("Profit B", afterB - beforeB);
    }
}
