// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CallOptionToken} from "../src/CallOptionToken.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// @notice 在 Forge 内存 EVM 完整模拟，禁止把时间跳转当成公共链交易。
contract Simulate is Script {
    /// @notice 发行 2 枚、转给 Alice 1 枚、行权 0.4 枚、过期销毁剩余 1.6 枚。
    function run() external {
        require(block.chainid == 31337, "local chain only");
        address issuer = address(0xA11);
        address alice = address(0xA11CE);
        vm.deal(issuer, 10 ether);
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 start = (block.timestamp / 1 days + 2) * 1 days;
        vm.startPrank(issuer);
        MockUSDT usdt = new MockUSDT(alice, 10_000e6);
        CallOptionToken option = new CallOptionToken(usdt, 2000e6, start);
        // 固定地址上刚部署的合约只接受本脚本的模拟入金。
        // forge-lint: disable-next-line(arbitrary-send-eth)
        option.issue{value: 2 ether}();
        require(option.transfer(alice, 1 ether), "option transfer failed");
        vm.stopPrank();
        console2.log("LOCAL EVM SIMULATION | chain ID", block.chainid);
        console2.log("Strike price (USDT / ETH): 2000 | UTC day starts", start);
        console2.log("ISSUE | deposited ETH: 2 | minted options: 2");
        console2.log("ISSUE | collateral (wei)", address(option).balance);
        console2.log("DISTRIBUTE | Alice options: 1 | issuer options: 1");

        vm.warp(start);
        vm.startPrank(alice);
        require(usdt.approve(address(option), 800e6), "payment approval failed");
        option.exercise(0.4 ether);
        vm.stopPrank();
        // 独立内存 EVM 的确定性断言，需要核对准确余额。
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(alice.balance == 0.4 ether && usdt.balanceOf(alice) == 9200e6, "exercise assets mismatch");
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(option.balanceOf(alice) == 0.6 ether && option.totalSupply() == 1.6 ether, "burn mismatch");
        console2.log("EXERCISE | Alice pays USDT: 800 | receives ETH: 0.4");
        console2.log("EXERCISE | Alice remaining options: 0.6 | total supply: 1.6");
        console2.log("EXERCISE | collateral (wei)", address(option).balance);
        console2.log("EXERCISE | proceeds held (USDT base units)", usdt.balanceOf(address(option)));

        vm.warp(option.exerciseEnd());
        vm.prank(issuer);
        option.expire(10);
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(option.totalSupply() == 0 && option.balanceOf(alice) == 0, "expiry burn mismatch");
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(issuer.balance == 9.6 ether && usdt.balanceOf(issuer) == 800e6, "redemption mismatch");
        // forge-lint: disable-next-line(incorrect-strict-equality)
        require(address(option).balance == 0 && usdt.balanceOf(address(option)) == 0, "assets remain");
        console2.log("EXPIRE | burned options: 1.6 | returned ETH: 1.6 | proceeds USDT: 800");
        console2.log("EXPIRE | total supply", option.totalSupply());
        console2.log("EXPIRE | collateral (wei)", address(option).balance);
        console2.log("PASS | issuance, exercise, expiry and asset assertions");
    }
}
