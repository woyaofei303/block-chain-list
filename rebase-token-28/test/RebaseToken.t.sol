// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/IERC6093.sol";
import {RebaseToken} from "../src/RebaseToken.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice 验证年度通缩、份额转账、ERC20 授权和整数边界，全部使用本地 EVM。
contract RebaseTokenTest is Test {
    RebaseToken private token;
    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    address private spender = makeAddr("spender");
    uint256 private start;
    uint256 private constant YEAR = 365 days;
    uint256 private constant INITIAL = 100_000_000 ether;

    /// @notice 每个测试独立部署，部署者为测试合约，避免跨用例共享余额和时间。
    function setUp() public {
        vm.warp(1_000_000);
        start = block.timestamp;
        token = new RebaseToken();
    }

    /// @notice 初始总量与部署者余额都是 1 亿枚，零地址没有份额。
    function testInitialSupplyAndMetadata() public view {
        assertEq(token.totalSupply(), INITIAL);
        assertEq(token.balanceOf(address(this)), INITIAL);
        assertEq(token.balanceOf(address(0)), 0);
        assertEq(token.decimals(), 18);
        assertEq(token.name(), "Rebase Token");
        assertEq(token.symbol(), "RBT");
        assertEq(token.lastRebaseTime(), start);
    }

    /// @notice 一年后任意账户触发 rebase，Alice 的 1000 枚变 990，Bob 的 2000 枚变 1980。
    function testRebaseUpdatesAllBalancesAfterOneYear() public {
        token.transfer(alice, 1000 ether);
        token.transfer(bob, 2000 ether);
        vm.warp(start + YEAR);
        vm.expectEmit(address(token));
        emit RebaseToken.Rebased(1, INITIAL, 99_000_000 ether);
        vm.prank(bob);
        assertEq(token.rebase(), 99_000_000 ether);
        assertEq(token.totalSupply(), 99_000_000 ether);
        assertEq(token.balanceOf(alice), 990 ether);
        assertEq(token.balanceOf(bob), 1980 ether);
        assertEq(token.balanceOf(address(this)), 98_997_030 ether);
    }

    /// @notice 第二年以第一年剩余总量计算，1000 枚两年后为 980.1 枚。
    function testSecondYearCompounds() public {
        token.transfer(alice, 1000 ether);
        vm.warp(start + YEAR);
        token.rebase();
        vm.warp(start + 2 * YEAR);
        token.rebase();
        assertEq(token.totalSupply(), 98_010_000 ether);
        assertEq(token.balanceOf(alice), 980.1 ether);
    }

    /// @notice 少一秒不足一年，失败后总量、余额与年度起点均保持原状。
    function testEarlyRebaseRevertsWithoutChangingState() public {
        vm.warp(start + YEAR - 1);
        vm.expectRevert(RebaseToken.RebaseTooEarly.selector);
        token.rebase();
        assertEq(token.totalSupply(), INITIAL);
        assertEq(token.balanceOf(address(this)), INITIAL);
        assertEq(token.lastRebaseTime(), start);
    }

    /// @notice 区块时间越过周年也不会自动改余额，必须实际调用 rebase。
    function testTimeAloneDoesNotRebase() public {
        token.transfer(alice, 1000 ether);
        vm.warp(start + YEAR);
        assertEq(token.balanceOf(alice), 1000 ether);
        token.transfer(bob, 100 ether);
        assertEq(token.totalSupply(), INITIAL);
        token.rebase();
        assertEq(token.balanceOf(bob), 99 ether);
    }

    /// @notice 延迟两年半调用会补算两年，并保留半年，第三周年仍可准时通缩。
    function testCatchUpPreservesPartialYearAndRejectsRepeat() public {
        token.transfer(alice, 1000 ether);
        vm.warp(start + 2 * YEAR + YEAR / 2);
        token.rebase();
        assertEq(token.totalSupply(), 98_010_000 ether);
        assertEq(token.balanceOf(alice), 980.1 ether);
        assertEq(token.lastRebaseTime(), start + 2 * YEAR);
        vm.expectRevert(RebaseToken.RebaseTooEarly.selector);
        token.rebase();
        vm.warp(start + 3 * YEAR);
        token.rebase();
        assertEq(token.totalSupply(), 97_029_900 ether);
        assertEq(token.balanceOf(alice), 970.299 ether);
    }

    /// @notice 通缩后按可见数量转账，双方余额准确增减，下一年新持有人也同比通缩。
    function testTransfersUseRebasedBalances() public {
        token.transfer(alice, 1000 ether);
        vm.warp(start + YEAR);
        token.rebase();
        vm.expectEmit(address(token));
        emit IERC20.Transfer(alice, bob, 90 ether);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 90 ether));
        assertEq(token.balanceOf(alice), 900 ether);
        assertEq(token.balanceOf(bob), 90 ether);
        vm.warp(start + 2 * YEAR);
        token.rebase();
        assertEq(token.balanceOf(alice), 891 ether);
        assertEq(token.balanceOf(bob), 89.1 ether);
    }

    /// @notice 零额转账仍发事件，自转账不增加余额，全部可见余额可以转出。
    function testZeroSelfAndFullBalanceTransfers() public {
        token.transfer(alice, 101);
        vm.warp(start + YEAR);
        token.rebase();
        vm.startPrank(alice);
        vm.expectEmit(address(token));
        emit IERC20.Transfer(alice, bob, 0);
        token.transfer(bob, 0);
        uint256 balance = token.balanceOf(alice);
        assertEq(balance, 99);
        token.transfer(alice, balance);
        assertEq(token.balanceOf(alice), balance);
        token.transfer(bob, balance);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), balance);
        vm.stopPrank();
    }

    /// @notice rebase 不缩放授权；代理转账按 Token 单位扣授权，最大授权不递减。
    function testAllowanceAndTransferFromAfterRebase() public {
        token.transfer(alice, 1000 ether);
        vm.prank(alice);
        token.approve(spender, 100 ether);
        vm.warp(start + YEAR);
        token.rebase();
        assertEq(token.allowance(alice, spender), 100 ether);
        vm.prank(spender);
        token.transferFrom(alice, bob, 40 ether);
        assertEq(token.allowance(alice, spender), 60 ether);
        assertEq(token.balanceOf(alice), 950 ether);
        assertEq(token.balanceOf(bob), 40 ether);
        vm.prank(alice);
        token.approve(spender, type(uint256).max);
        vm.prank(spender);
        token.transferFrom(alice, bob, 1 ether);
        assertEq(token.allowance(alice, spender), type(uint256).max);
    }

    /// @notice 旧余额不再可花；余额不足时 transferFrom 已扣的授权也会随交易回滚。
    function testInsufficientBalanceRollsBackAllowance() public {
        token.transfer(alice, 1000 ether);
        vm.prank(alice);
        token.approve(spender, 1000 ether);
        vm.warp(start + YEAR);
        token.rebase();
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 990 ether, 1000 ether)
        );
        vm.prank(spender);
        token.transferFrom(alice, bob, 1000 ether);
        assertEq(token.allowance(alice, spender), 1000 ether);
        assertEq(token.balanceOf(alice), 990 ether);
        assertEq(token.balanceOf(bob), 0);
    }

    /// @notice 授权不足与超大金额均正确拒绝，不因先乘换算比例而触发溢出。
    function testInvalidAllowanceAndHugeAmountRevert() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, 0, 1));
        vm.prank(spender);
        token.transferFrom(address(this), bob, 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, address(this), INITIAL, type(uint256).max
            )
        );
        token.transfer(bob, type(uint256).max);
    }

    /// @notice 拒绝向零地址转账或授权，也拒绝以零地址作为发送者。
    function testZeroAddressesRevert() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        token.approve(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSender.selector, address(0)));
        vm.prank(address(0));
        token.transfer(bob, 0);
    }

    /// @notice 极端时间跨度最终使整数总量归零，不无限循环或除零；之后只允许零额转账。
    function testExtremeTimeEventuallyReachesZero() public {
        token.transfer(alice, 1000 ether);
        vm.warp(type(uint256).max - YEAR);
        token.rebase();
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(address(this)), 0);
        assertTrue(token.transfer(bob, 0));
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(this), 0, 1));
        token.transfer(bob, 1);
        vm.warp(type(uint256).max);
        assertEq(token.rebase(), 0);
    }

    /// @notice 随机持仓与年份对照独立比例公式，单账户舍入误差最多一个最小单位。
    function testFuzzRebasedBalancesAndTransfer(uint256 amount, uint256 yearsElapsed, uint256 transferAmount) public {
        amount = bound(amount, 0, INITIAL);
        yearsElapsed = bound(yearsElapsed, 1, 100);
        token.transfer(alice, amount);
        uint256 expectedSupply = INITIAL;
        for (uint256 i; i < yearsElapsed; ++i) {
            expectedSupply = expectedSupply * 99 / 100;
        }
        vm.warp(start + yearsElapsed * YEAR);
        token.rebase();
        uint256 aliceBalance = token.balanceOf(alice);
        uint256 ownerBalance = token.balanceOf(address(this));
        assertEq(token.totalSupply(), expectedSupply);
        assertApproxEqAbs(aliceBalance, amount * expectedSupply / INITIAL, 1);
        assertLe(aliceBalance + ownerBalance, expectedSupply);
        assertLe(expectedSupply - aliceBalance - ownerBalance, 1);
        transferAmount = bound(transferAmount, 0, aliceBalance);
        vm.prank(alice);
        token.transfer(bob, transferAmount);
        assertEq(token.balanceOf(alice), aliceBalance - transferAmount);
        assertEq(token.balanceOf(bob), transferAmount);
    }

    /// @notice 按年执行和多年后补算得到相同结果，包含整数舍入，避免浮点幂近似。
    function testFuzzCatchUpMatchesYearlyRebases(uint256 yearsElapsed) public {
        yearsElapsed = bound(yearsElapsed, 1, 100);
        RebaseToken yearly = new RebaseToken();
        yearly.transfer(alice, 123_456_789);
        token.transfer(alice, 123_456_789);
        for (uint256 i = 1; i <= yearsElapsed; ++i) {
            vm.warp(start + i * YEAR);
            yearly.rebase();
        }
        token.rebase();
        assertEq(token.totalSupply(), yearly.totalSupply());
        assertEq(token.balanceOf(alice), yearly.balanceOf(alice));
        assertEq(token.lastRebaseTime(), yearly.lastRebaseTime());
    }

    /// @notice 本地教学脚本拒绝主网 chain ID，阻止误用该入口部署到公共网络。
    function testDeploymentScriptRejectsNonLocalChain() public {
        Deploy deploy = new Deploy();
        vm.chainId(1);
        vm.expectRevert("local chain only");
        deploy.run();
    }
}
