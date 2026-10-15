// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KKToken} from "../src/KKToken.sol";
import {StakingPool} from "../src/StakingPool.sol";
import {CompoundStakingPool} from "../src/CompoundStakingPool.sol";
import {ICEther} from "../src/interfaces/ICEther.sol";
import {Receiver} from "./StakingPool.t.sol";

/// @notice 本地 cETH 替身，以可控汇率验证份额和回滚；不模拟真实利率曲线。
contract MockCEther is ICEther {
    mapping(address => uint256) public override balanceOf;
    uint256 public exchangeRate = 2e26;
    uint256 public redeemError;
    bool public mintPaused;

    /// @notice 仅测试设置汇率；真实 cETH 的汇率由市场借贷和利息累计决定。
    function setExchangeRate(uint256 rate) external {
        exchangeRate = rate;
    }

    /// @notice 测试故障注入：暂停存款，或让赎回返回非零状态码。
    function setFailure(bool paused, uint256 errorCode) external {
        mintPaused = paused;
        redeemError = errorCode;
    }

    /// @notice 按 ETH/汇率向下取整铸造 cETH；暂停时回滚整笔 ETH 存入。
    function mint() external payable override {
        require(!mintPaused, "mint paused");
        balanceOf[msg.sender] += msg.value * 1e18 / exchangeRate;
    }

    /// @notice 模拟 cETH 的 2300 gas 返款；错误码分支不改变份额。
    function redeem(uint256 shares) external override returns (uint256) {
        if (redeemError != 0) return redeemError;
        balanceOf[msg.sender] -= shares;
        // 保持上游 CEther 的 transfer 语义，以检验接收回调的 gas 限制。
        payable(msg.sender).transfer(shares * exchangeRate / 1e18);
        return 0;
    }
}

/// @notice 验证借贷份额属于实际存款人，并覆盖底层市场失败。
contract CompoundStakingPoolTest is Test {
    KKToken internal token;
    MockCEther internal market;
    CompoundStakingPool internal pool;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    /// @notice 创建独立市场和池；额外 ETH 仅供本地模拟市场支付利息。
    function setUp() public {
        vm.roll(100);
        token = new KKToken(address(this));
        market = new MockCEther();
        pool = new CompoundStakingPool(token, market);
        token.transferOwnership(address(pool));
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.deal(address(market), 1000 ether);
    }

    /// @notice 让指定用户实际调用 stake，将 ETH 转入模拟市场。
    function _stake(address account, uint256 amount) internal {
        vm.prank(account);
        pool.stake{value: amount}();
    }

    /// @notice ETH 离开池进入市场，池持有 cETH，个人只记自己的新增份额。
    function testStakeSuppliesETH() public {
        _stake(alice, 1 ether);
        assertEq(address(pool).balance, 0);
        assertEq(address(market).balance, 1001 ether);
        assertEq(pool.cTokenBalance(alice), 50e8);
        assertEq(market.balanceOf(address(pool)), 50e8);
        assertEq(pool.balanceOf(alice), 1 ether);
    }

    /// @notice 汇率上涨后才存款的 Bob 不分享 Alice 之前的 0.1 ETH 利息。
    function testLateDepositorCannotTakeOldInterest() public {
        _stake(alice, 1 ether);
        market.setExchangeRate(22e25);
        vm.roll(110);
        _stake(bob, 11e17);
        vm.startPrank(alice);
        pool.unstake(1 ether);
        pool.claim();
        vm.stopPrank();
        vm.prank(bob);
        pool.unstake(11e17);
        assertEq(alice.balance, 1000 ether + 1e17);
        assertEq(bob.balance, 1000 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(pool.earned(bob), 0);
        assertEq(market.balanceOf(address(pool)), 0);
    }

    /// @notice 先按本金比例赎回部分 cETH，完全退出时连同所有余量和利息取尽。
    function testPartialExitReturnsProportionalInterest() public {
        _stake(alice, 2 ether);
        market.setExchangeRate(22e25);
        vm.startPrank(alice);
        pool.unstake(1 ether);
        assertEq(pool.balanceOf(alice), 1 ether);
        assertEq(pool.cTokenBalance(alice), 50e8);
        assertEq(alice.balance, 9991e17);
        market.setExchangeRate(24e25);
        pool.unstake(1 ether);
        vm.stopPrank();
        assertEq(alice.balance, 10003e17);
        assertEq(pool.cTokenBalance(alice), 0);
    }

    /// @notice 同一个账户在不同汇率追加存款，份额累加后赎回仍保留早期利息。
    function testTopUpAtNewExchangeRate() public {
        _stake(alice, 1 ether);
        market.setExchangeRate(22e25);
        _stake(alice, 11e17);
        assertEq(pool.cTokenBalance(alice), 100e8);
        vm.prank(alice);
        pool.unstake(21e17);
        assertEq(alice.balance, 10001e17);
    }

    /// @notice 市场暂停存款时，ETH、本金账本、份额和奖励快照全部回滚。
    function testMintFailureRollsBack() public {
        market.setFailure(true, 0);
        vm.prank(alice);
        vm.expectRevert("mint paused");
        pool.stake{value: 1 ether}();
        assertEq(pool.totalStaked(), 0);
        assertEq(pool.cTokenBalance(alice), 0);
        assertEq(alice.balance, 1000 ether);
    }

    /// @notice 非零 redeem 错误码必须触发回滚，不能把失败当作已归还本金。
    function testRedeemFailureRollsBack() public {
        _stake(alice, 1 ether);
        vm.roll(110);
        market.setFailure(false, 14);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CompoundStakingPool.RedeemFailed.selector, 14));
        pool.unstake(1 ether);
        assertEq(pool.balanceOf(alice), 1 ether);
        assertEq(pool.cTokenBalance(alice), 50e8);
        assertEq(pool.lastRewardBlock(), 100);
        assertEq(pool.earned(alice), 100 ether);
    }

    /// @notice 市场缺少可提 ETH 时，外部转账回滚也必须恢复用户份额。
    function testMarketLiquidityFailureRollsBack() public {
        _stake(alice, 1 ether);
        vm.deal(address(market), 0);
        vm.prank(alice);
        vm.expectRevert();
        pool.unstake(1 ether);
        assertEq(pool.balanceOf(alice), 1 ether);
        assertEq(market.balanceOf(address(pool)), 50e8);
    }

    /// @notice 取回市场资产后若用户拒收，连市场的份额销毁也一同回滚。
    function testRejectedETHRestoresMarketShares() public {
        Receiver receiver = new Receiver(pool);
        receiver.deposit{value: 1 ether}();
        receiver.setReject(true);
        vm.expectRevert(StakingPool.ETHTransferFailed.selector);
        receiver.withdraw(1 ether);
        assertEq(pool.cTokenBalance(address(receiver)), 50e8);
        assertEq(market.balanceOf(address(pool)), 50e8);
        assertEq(pool.balanceOf(address(receiver)), 1 ether);
    }

    /// @notice 借贷版沿用基础池的锁，赎回 ETH 回调不能重入任何资金入口。
    function testLendingWithdrawalBlocksReentry() public {
        Receiver receiver = new Receiver(pool);
        receiver.deposit{value: 1 ether}();
        receiver.withdraw(1 ether);
        assertTrue(receiver.checkedReentry());
        assertEq(pool.cTokenBalance(address(receiver)), 0);
    }

    /// @notice 会换到零 cETH 的小额存款或部分提款回滚；全额退出仍可成功。
    function testDustAmountsDoNotBurnPrincipal() public {
        vm.prank(alice);
        vm.expectRevert(CompoundStakingPool.AmountTooSmall.selector);
        pool.stake{value: 1}();
        _stake(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(CompoundStakingPool.AmountTooSmall.selector);
        pool.unstake(1);
        assertEq(pool.balanceOf(alice), 1 ether);
        vm.prank(alice);
        pool.unstake(1 ether);
        assertEq(pool.balanceOf(alice), 0);
    }

    /// @notice 禁止无代码市场和任意直接 ETH 转账，避免误认为转账已记账。
    function testInvalidMarketAndSender() public {
        vm.expectRevert(CompoundStakingPool.InvalidMarket.selector);
        new CompoundStakingPool(token, ICEther(alice));
        (bool ok,) = address(pool).call{value: 1}("");
        assertFalse(ok);
        assertEq(pool.totalStaked(), 0);
    }

    /// @notice 随机本金分两次赎回后份额归零；舍入损失小于两个 cETH 最小单位价值。
    function testFuzzSharesFullyRedeemed(uint96 rawAmount, uint96 rawPart) public {
        uint256 amount = bound(uint256(rawAmount), 1e15, 100 ether);
        uint256 part = bound(uint256(rawPart), 1e10, amount - 1e10);
        _stake(alice, amount);
        vm.startPrank(alice);
        pool.unstake(part);
        pool.unstake(amount - part);
        vm.stopPrank();
        assertEq(pool.cTokenBalance(alice), 0);
        assertEq(market.balanceOf(address(pool)), 0);
        assertApproxEqAbs(alice.balance, 1000 ether, 4e8);
    }
}
