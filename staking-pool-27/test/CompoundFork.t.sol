// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KKToken} from "../src/KKToken.sol";
import {CompoundStakingPool} from "../src/CompoundStakingPool.sol";
import {ICEther} from "../src/interfaces/ICEther.sol";

/// @notice 在固定主网历史状态的本地副本调用真实 cETH，不产生公共链交易。
contract CompoundForkTest is Test {
    /// @notice 未配置 RPC 时明确跳过；配置后验证真实 mint、2300 gas 返款和 KK 领取。
    function testForkSupplyAndRedeem() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0, "MAINNET_RPC_URL not set");
        vm.createSelectFork(rpc, 20_000_000);
        ICEther market = ICEther(0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5);
        KKToken token = new KKToken(address(this));
        CompoundStakingPool pool = new CompoundStakingPool(token, market);
        token.transferOwnership(address(pool));
        address alice = address(0xA11CE);
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        pool.stake{value: 2 ether}();
        assertGt(pool.cTokenBalance(alice), 0);
        assertEq(address(pool).balance, 0);
        vm.roll(block.number + 100);
        vm.startPrank(alice);
        pool.unstake(2 ether);
        pool.claim();
        vm.stopPrank();
        assertGt(alice.balance, 2 ether);
        assertEq(token.balanceOf(alice), 1000 ether);
        assertEq(pool.totalStaked(), 0);
        assertEq(market.balanceOf(address(pool)), 0);
    }
}
