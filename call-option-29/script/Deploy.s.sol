// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CallOptionToken} from "../src/CallOptionToken.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// @notice 部署本地支付币与期权，公开测试账户 Alice 获得 10000 mUSDT。
contract Deploy is Script {
    address public constant ALICE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    /// @notice 只允许本地链；行权日为后天 UTC 零点，发行方由 --sender 指定。
    function run() external returns (MockUSDT usdt, CallOptionToken option) {
        require(block.chainid == 31337, "local chain only");
        // 先按整日对齐，再选未来日期，保留本地发行演示时间。
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 start = (block.timestamp / 1 days + 2) * 1 days;
        vm.startBroadcast();
        usdt = new MockUSDT(ALICE, 10_000e6);
        option = new CallOptionToken(usdt, 2000e6, start);
        vm.stopBroadcast();
        console2.log("MockUSDT", address(usdt));
        console2.log("CallOptionToken", address(option));
        console2.log("Issuer", option.issuer());
        console2.log("Exercise start (UTC unix)", option.exerciseStart());
        console2.log("Exercise end (exclusive)", option.exerciseEnd());
    }
}
