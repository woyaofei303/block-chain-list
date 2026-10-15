// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {KKToken} from "../src/KKToken.sol";
import {StakingPool} from "../src/StakingPool.sol";
import {IToken} from "../src/interfaces/IToken.sol";

/// @notice 测试拒收 ETH 和跨入口重入；仅用于本地验证。
contract Receiver {
    StakingPool internal immutable pool;
    bool public rejectETH;
    bool public checkedReentry;

    /// @notice 绑定待测试的池，不能在运行中更换。
    constructor(StakingPool target) {
        pool = target;
    }

    /// @notice 让合约账户质押传入的全部 ETH。
    function deposit() external payable {
        pool.stake{value: msg.value}();
    }

    /// @notice 设置拒收开关，用于验证提款失败后账本回滚。
    function setReject(bool reject) external {
        rejectETH = reject;
    }

    /// @notice 转发本金赎回，由 receive 检查池的重入防护。
    function withdraw(uint256 amount) external {
        pool.unstake(amount);
    }

    /// @notice 接收提款时尝试重入三个入口，必须都被同一把锁拒绝。
    receive() external payable {
        require(!rejectETH, "reject ETH");
        (bool a, bytes memory ea) = address(pool).call(abi.encodeCall(pool.unstake, (1)));
        (bool b, bytes memory eb) = address(pool).call(abi.encodeCall(pool.claim, ()));
        (bool c, bytes memory ec) = address(pool).call{value: 1}(abi.encodeCall(pool.stake, ()));
        bytes4 expected = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        require(!a && !b && !c && bytes4(ea) == expected && bytes4(eb) == expected && bytes4(ec) == expected);
        checkedReentry = true;
    }
}

/// @notice 基础池的时间分段、金额、权限和失败回滚测试。
contract StakingPoolTest is Test {
    KKToken internal token;
    StakingPool internal pool;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    /// @notice 每项测试从区块 100 和独立空池开始，只有池有 KK 铸币权限。
    function setUp() public {
        vm.roll(100);
        token = new KKToken(address(this));
        pool = new StakingPool(token);
        token.transferOwnership(address(pool));
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
    }

    /// @notice 指定账户质押 amount；使用 prank 保留真实 msg.sender 记账语义。
    function _stake(address account, uint256 amount) internal {
        vm.prank(account);
        pool.stake{value: amount}();
    }

    /// @notice 单人经过十个区块应得 100 KK；查询不铸币，claim 才铸币。
    function testSingleStaker() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        assertEq(pool.earned(alice), 100 ether);
        assertEq(token.totalSupply(), 0);
        vm.prank(alice);
        pool.claim();
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(pool.earned(alice), 0);
        assertEq(address(pool).balance, 1 ether);
    }

    /// @notice Alice 先存 1 ETH，十块后 Bob 存 3 ETH，再过十块分别得 125/75 KK。
    function testDifferentArrivalAndAmounts() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        _stake(bob, 3 ether);
        assertEq(pool.earned(bob), 0);
        vm.roll(120);
        assertEq(pool.earned(alice), 125 ether);
        assertEq(pool.earned(bob), 75 ether);
    }

    /// @notice 追加本金前结算旧比例，后十块 Alice 占 3/4，不能追溯修改前十块。
    function testTopUpSettlesOldBalance() public {
        _stake(alice, 1 ether);
        _stake(bob, 1 ether);
        vm.roll(110);
        _stake(alice, 2 ether);
        vm.roll(120);
        assertEq(pool.earned(alice), 125 ether);
        assertEq(pool.earned(bob), 75 ether);
    }

    /// @notice 部分退出后按剩余本金分配，历史 KK 保留且赎回本金回到用户。
    function testPartialUnstakeChangesFutureWeight() public {
        _stake(alice, 2 ether);
        _stake(bob, 2 ether);
        vm.roll(110);
        vm.prank(alice);
        pool.unstake(1 ether);
        vm.roll(116);
        assertEq(pool.balanceOf(alice), 1 ether);
        assertEq(pool.totalStaked(), 3 ether);
        assertEq(alice.balance, 9999 ether);
        assertEq(pool.earned(alice), 70 ether);
        assertEq(pool.earned(bob), 90 ether);
    }

    /// @notice 完全退出后停止计奖，但之后仍能领取退出前积累的 KK。
    function testClaimAfterFullExit() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        vm.prank(alice);
        pool.unstake(1 ether);
        vm.roll(200);
        vm.prank(alice);
        pool.claim();
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(pool.totalStaked(), 0);
        assertEq(alice.balance, 10_000 ether);
    }

    /// @notice 部署后和清空后的空池区间都不补发；重新入场保留自己的旧奖励。
    function testEmptyIntervalsAndRestake() public {
        vm.roll(200);
        _stake(alice, 1 ether);
        assertEq(pool.earned(alice), 0);
        vm.roll(210);
        vm.prank(alice);
        pool.unstake(1 ether);
        vm.roll(300);
        _stake(alice, 1 ether);
        vm.roll(310);
        assertEq(pool.earned(alice), 200 ether);
    }

    /// @notice 同一区块的存、领、退没有经过区块，奖励为零。
    function testSameBlockCannotEarn() public {
        _stake(alice, 1 ether);
        vm.startPrank(alice);
        pool.claim();
        pool.unstake(1 ether);
        vm.stopPrank();
        assertEq(token.totalSupply(), 0);
        assertEq(pool.earned(alice), 0);
    }

    /// @notice 领取只清空已领额度，不改变占比；重复领取不增发。
    function testRepeatedClaims() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        vm.startPrank(alice);
        pool.claim();
        pool.claim();
        vm.roll(120);
        pool.claim();
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 200 ether);
        assertEq(pool.balanceOf(alice), 1 ether);
    }

    /// @notice 分母从 4 ETH 变成 3 ETH 时允许 1 个 KK 最小单位舍入，累计领取不能超发。
    function testRoundingAcrossFullExits() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        _stake(bob, 3 ether);
        vm.roll(121);
        vm.prank(alice);
        pool.unstake(1 ether);
        vm.roll(122);
        vm.prank(alice);
        pool.claim();
        vm.roll(123);
        vm.prank(bob);
        pool.unstake(3 ether);
        vm.prank(bob);
        pool.claim();
        assertEq(token.balanceOf(alice), 1275e17);
        assertEq(token.balanceOf(bob), 1025e17 - 1);
        assertEq(token.totalSupply(), 230 ether - 1);
    }

    /// @notice 零存款、零赎回、超过余额和陌生账户提款均回滚。
    function testInvalidAmounts() public {
        vm.expectRevert(StakingPool.ZeroAmount.selector);
        pool.stake();
        vm.expectRevert(StakingPool.ZeroAmount.selector);
        pool.unstake(0);
        _stake(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(StakingPool.InsufficientStake.selector);
        pool.unstake(1 ether + 1);
        vm.prank(bob);
        vm.expectRevert(StakingPool.InsufficientStake.selector);
        pool.unstake(1);
        assertEq(pool.totalStaked(), 1 ether);
    }

    /// @notice KK 地址必须有合约代码；零地址与普通账户都不能作为奖励合约。
    function testInvalidToken() public {
        vm.expectRevert(StakingPool.InvalidToken.selector);
        new StakingPool(IToken(address(0)));
        vm.expectRevert(StakingPool.InvalidToken.selector);
        new StakingPool(IToken(alice));
    }

    /// @notice 原部署者与普通用户都不能在交接权限后绕过池直接铸币。
    function testOnlyPoolCanMint() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        token.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1);
    }

    /// @notice 忘记交接铸币权限会令 claim 回滚，但不会阻止用户退出 ETH。
    function testMintFailurePreservesRewardAndWithdrawal() public {
        KKToken otherToken = new KKToken(address(this));
        StakingPool otherPool = new StakingPool(otherToken);
        vm.prank(alice);
        otherPool.stake{value: 1 ether}();
        vm.roll(110);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(otherPool)));
        otherPool.claim();
        assertEq(otherPool.earned(alice), 100 ether);
        vm.prank(alice);
        otherPool.unstake(1 ether);
        otherToken.transferOwnership(address(otherPool));
        vm.prank(alice);
        otherPool.claim();
        assertEq(otherToken.balanceOf(alice), 100 ether);
    }

    /// @notice 合约拒收 ETH 时，余额、总质押和奖励结算区块都必须保持原状。
    function testRejectedETHRollsBack() public {
        Receiver receiver = new Receiver(pool);
        receiver.deposit{value: 1 ether}();
        receiver.setReject(true);
        vm.roll(110);
        vm.expectRevert(StakingPool.ETHTransferFailed.selector);
        receiver.withdraw(1 ether);
        assertEq(pool.balanceOf(address(receiver)), 1 ether);
        assertEq(pool.totalStaked(), 1 ether);
        assertEq(pool.lastRewardBlock(), 100);
        assertEq(pool.earned(address(receiver)), 100 ether);
    }

    /// @notice ETH 回调不能再次进入 stake、unstake 或 claim，其他用户本金不受影响。
    function testCrossFunctionReentryBlocked() public {
        _stake(bob, 1 ether);
        Receiver receiver = new Receiver(pool);
        receiver.deposit{value: 1 ether}();
        receiver.withdraw(1 ether);
        assertTrue(receiver.checkedReentry());
        assertEq(pool.balanceOf(address(receiver)), 0);
        assertEq(address(pool).balance, 1 ether);
    }

    /// @notice 普通转账不能记成质押；强制进入的 ETH 也不能凭空创建用户本金。
    function testDirectAndForcedETHDoNotCreateStake() public {
        (bool ok,) = address(pool).call{value: 1 ether}("");
        assertFalse(ok);
        vm.deal(address(pool), 7 ether);
        _stake(alice, 1 ether);
        vm.roll(110);
        assertEq(pool.totalStaked(), 1 ether);
        assertEq(pool.earned(alice), 100 ether);
    }

    /// @notice 随机比例下总领取不超过区块产量，误差只允许最小单位级的向下舍入。
    function testFuzzRewardConservation(uint96 rawA, uint96 rawB, uint16 blocksElapsed) public {
        uint256 a = bound(uint256(rawA), 1, 1000 ether);
        uint256 b = bound(uint256(rawB), 1, 1000 ether);
        _stake(alice, a);
        _stake(bob, b);
        vm.roll(100 + uint256(blocksElapsed));
        uint256 emission = uint256(blocksElapsed) * 10 ether;
        assertApproxEqAbs(pool.earned(alice), emission * a / (a + b), 1);
        assertApproxEqAbs(pool.earned(bob), emission * b / (a + b), 1);
        vm.prank(alice);
        pool.claim();
        vm.prank(bob);
        pool.claim();
        assertLe(token.totalSupply(), emission);
        assertLe(emission - token.totalSupply(), 3);
    }

    /// @notice 随机赎回量只扣自己的本金；全部退出后可恢复最初 ETH 余额。
    function testFuzzPartialAndFullExit(uint96 rawAmount, uint96 rawPart) public {
        uint256 amount = bound(uint256(rawAmount), 2, 1000 ether);
        uint256 part = bound(uint256(rawPart), 1, amount - 1);
        _stake(alice, amount);
        vm.startPrank(alice);
        pool.unstake(part);
        assertEq(pool.balanceOf(alice), amount - part);
        pool.unstake(amount - part);
        vm.stopPrank();
        assertEq(alice.balance, 10_000 ether);
        assertEq(pool.totalStaked(), 0);
    }
}
