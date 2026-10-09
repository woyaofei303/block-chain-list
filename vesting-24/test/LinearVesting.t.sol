// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "openzeppelin-contracts/contracts/interfaces/IERC6093.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {LinearVesting} from "../src/LinearVesting.sol";
import {VestingToken} from "../src/VestingToken.sol";

contract LinearVestingTest is Test {
    uint256 private constant TOTAL_ALLOCATION = 1_000_000 ether;

    VestingToken private token;
    LinearVesting private vesting;
    address private beneficiary;

    /// @notice 部署测试代币、Vesting，并把题目要求的 100 万枚代币转入锁仓合约。
    function setUp() public {
        beneficiary = makeAddr("beneficiary");
        token = new VestingToken();
        vesting = new LinearVesting(beneficiary, address(token), TOTAL_ALLOCATION);
        assertTrue(token.transfer(address(vesting), TOTAL_ALLOCATION));
    }

    /// @notice 验证 12 个月 Cliff 尚未结束时，受益人没有可释放额度。
    function testBeforeCliffNothingIsVested() public {
        vm.warp(vesting.start() + vesting.CLIFF_DURATION() - 1);

        assertEq(vesting.releasable(), 0);
        vesting.release();
        assertEq(vesting.released(), 0);
        assertEq(token.balanceOf(beneficiary), 0);
        assertEq(token.balanceOf(address(vesting)), TOTAL_ALLOCATION);
    }

    /// @notice 验证 Cliff 后完整经过第一个月时，恰好归属总配额的 1/24。
    function testFirstMonthAfterCliffReleasesOneTwentyFourth() public {
        uint256 expected = TOTAL_ALLOCATION / 24;
        vm.warp(vesting.start() + vesting.CLIFF_DURATION() + vesting.MONTH());

        assertEq(vesting.vestedAmount(block.timestamp), expected);
        vm.prank(beneficiary);
        vesting.release();

        assertEq(token.balanceOf(beneficiary), expected);
        assertEq(vesting.released(), expected);
        assertEq(token.balanceOf(address(vesting)), TOTAL_ALLOCATION - expected);
    }

    /// @notice 验证月中不新增额度，满 13 个月后再过 15 天仍只归属 1/24。
    function testMidMonthDoesNotUnlockNextInstallment() public {
        vm.warp(vesting.start() + vesting.CLIFF_DURATION() + vesting.MONTH() + 15 days);

        uint256 expected = TOTAL_ALLOCATION / 24;
        assertEq(vesting.releasable(), expected);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), expected);
    }

    /// @notice 验证达到完整 Vesting 期限后，剩余配额只能释放一次且总量不超发。
    function testFinalReleasePaysRemainingAllocation() public {
        uint256 start = vesting.start();
        vm.warp(start + 13 * vesting.MONTH());
        vesting.release();
        vm.warp(vesting.start() + vesting.CLIFF_DURATION() + vesting.VESTING_DURATION());
        vesting.release();
        vm.warp(start + 60 * vesting.MONTH());
        vesting.release();

        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION);
        assertEq(vesting.released(), TOTAL_ALLOCATION);
        assertEq(token.balanceOf(address(vesting)), 0);
        assertEq(vesting.releasable(), 0);
    }

    /// @notice 验证受益人、代币地址和总配额的信任边界不能使用无效值。
    function testInvalidParametersRevert() public {
        vm.expectRevert(LinearVesting.InvalidParameters.selector);
        new LinearVesting(address(0), address(token), TOTAL_ALLOCATION);

        vm.expectRevert(LinearVesting.InvalidParameters.selector);
        new LinearVesting(beneficiary, address(0), TOTAL_ALLOCATION);

        vm.expectRevert(LinearVesting.InvalidParameters.selector);
        new LinearVesting(beneficiary, address(token), 0);
    }

    /// @notice 代币必须是已部署合约，防止把普通钱包地址误当成 ERC20 锁入计划。
    function testTokenWithoutCodeReverts() public {
        address notAToken = makeAddr("not-a-token");
        vm.expectRevert(LinearVesting.InvalidParameters.selector);
        new LinearVesting(beneficiary, notAToken, TOTAL_ALLOCATION);
    }

    /// @notice 满 12 个月和满 13 个月前一秒均不能领取，首期必须等完整一个释放月。
    function testCliffAndFirstUnlockBoundaries() public {
        uint256 start = vesting.start();
        uint256 month = vesting.MONTH();
        vm.warp(start + 12 * month);
        vesting.release();
        assertEq(vesting.released(), 0);

        vm.warp(start + 13 * month - 1);
        vesting.release();
        assertEq(vesting.released(), 0);
        assertEq(vesting.releasable(), 0);

        vm.warp(start + 13 * month);
        assertEq(vesting.releasable(), TOTAL_ALLOCATION / 24);
    }

    /// @notice 任意人可代为触发，但收款人固定；同月重复调用不会重复付款或发出事件。
    function testAnyoneCanReleaseOnlyToBeneficiaryAndCannotDoubleClaim() public {
        address caller = makeAddr("caller");
        vm.warp(vesting.start() + 13 * vesting.MONTH());
        vm.expectEmit(false, false, false, true, address(vesting));
        emit LinearVesting.Released(TOTAL_ALLOCATION / 24);
        vm.prank(caller);
        vesting.release();

        vm.warp(block.timestamp + 15 days);
        vm.recordLogs();
        vm.prank(caller);
        vesting.release();

        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(token.balanceOf(caller), 0);
        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION / 24);
        assertEq(vesting.releasable(), 0);
    }

    /// @notice 跳过领取月份后，一次领取全部已解锁差额，不从上次领取时间重新计时。
    function testMissedMonthsAccumulate() public {
        uint256 start = vesting.start();
        uint256 month = vesting.MONTH();
        vm.warp(start + 13 * month);
        vesting.release();
        vm.warp(start + 24 * month);

        assertEq(vesting.releasable(), TOTAL_ALLOCATION / 2 - TOTAL_ALLOCATION / 24);
        vesting.release();
        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION / 2);
    }

    /// @notice 逐月推进 24 期，校验边界、重复领取、余额守恒及最终不可整除的尾差。
    function testAll24InstallmentsConserveAllocation() public {
        uint256 cliff = vesting.start() + vesting.CLIFF_DURATION();
        uint256 month = vesting.MONTH();
        for (uint256 installment = 1; installment <= 24; ++installment) {
            vm.warp(cliff + installment * month - 1);
            assertEq(vesting.releasable(), 0);
            vm.warp(cliff + installment * month);
            vesting.release();
            vesting.release();

            uint256 expected = TOTAL_ALLOCATION * installment / 24;
            assertEq(vesting.released(), expected);
            assertEq(token.balanceOf(beneficiary), expected);
            assertEq(token.balanceOf(address(vesting)) + expected, TOTAL_ALLOCATION);
        }
        assertEq(token.balanceOf(address(vesting)), 0);
    }

    /// @notice 实际余额不足会回滚已释放计数；补足资金后可再次领取同一额度。
    function testUnderfundingRollsBackAndCanRetry() public {
        LinearVesting unfunded = new LinearVesting(beneficiary, address(token), TOTAL_ALLOCATION);
        vm.warp(unfunded.start() + 13 * unfunded.MONTH());
        uint256 amount = TOTAL_ALLOCATION / 24;
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(unfunded), 0, amount)
        );
        unfunded.release();
        assertEq(unfunded.released(), 0);
        assertEq(token.balanceOf(beneficiary), 0);

        assertTrue(token.transfer(address(unfunded), TOTAL_ALLOCATION));
        unfunded.release();
        assertEq(unfunded.released(), amount);
        assertEq(token.balanceOf(beneficiary), amount);
    }

    /// @notice 外部 ERC20 返回 false 时 SafeERC20 必须回滚，不能把失败转账记为已释放。
    function testFalseReturnRollsBack() public {
        vm.warp(vesting.start() + 13 * vesting.MONTH());
        vm.mockCall(
            address(token), abi.encodeCall(IERC20.transfer, (beneficiary, TOTAL_ALLOCATION / 24)), abi.encode(false)
        );
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        vesting.release();
        assertEq(vesting.released(), 0);
        assertEq(token.balanceOf(address(vesting)), TOTAL_ALLOCATION);
        vm.clearMockedCalls();
        vesting.release();
        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION / 24);
    }

    /// @notice 转账期间代币重入 release 也不能二次领取，因为累计计数在外部调用前更新。
    function testReentrantTransferCannotDoubleRelease() public {
        ReentrantToken callbackToken = new ReentrantToken();
        LinearVesting callbackVesting = new LinearVesting(beneficiary, address(callbackToken), TOTAL_ALLOCATION);
        assertTrue(callbackToken.transfer(address(callbackVesting), TOTAL_ALLOCATION));
        callbackToken.enableReentry();
        vm.warp(callbackVesting.start() + 13 * callbackVesting.MONTH());

        callbackVesting.release();
        assertEq(callbackVesting.released(), TOTAL_ALLOCATION / 24);
        assertEq(callbackToken.balanceOf(beneficiary), TOTAL_ALLOCATION / 24);
        assertEq(callbackToken.balanceOf(address(callbackVesting)), TOTAL_ALLOCATION - TOTAL_ALLOCATION / 24);
    }

    /// @notice 部署后的额外转入不改变固定配额或计时，超出配额的余额不会自动归属。
    function testExtraFundingDoesNotChangeSchedule() public {
        uint256 start = vesting.start();
        vm.warp(start + 18 * vesting.MONTH());
        assertTrue(token.transfer(address(vesting), 1 ether));
        assertEq(vesting.start(), start);
        assertEq(vesting.releasable(), TOTAL_ALLOCATION / 4);
        vm.warp(start + 36 * vesting.MONTH());
        vesting.release();
        assertEq(token.balanceOf(beneficiary), TOTAL_ALLOCATION);
        assertEq(token.balanceOf(address(vesting)), 1 ether);
    }

    /// @notice 随机全范围配额与月份保持整月比例；用商和余数独立校验乘法溢出与尾差。
    function testFuzzMonthlySchedule(uint256 allocation, uint8 rawMonths, uint32 rawOffset) public {
        allocation = bound(allocation, 1, type(uint256).max);
        LinearVesting varied = new LinearVesting(beneficiary, address(token), allocation);
        uint256 elapsedMonths = bound(rawMonths, 0, 48);
        uint256 offset = bound(rawOffset, 0, varied.MONTH() - 1);
        uint256 expected = 0;
        if (elapsedMonths >= 36) {
            expected = allocation;
        } else if (elapsedMonths > 12) {
            uint256 installments = elapsedMonths - 12;
            // 商和余数一起计算可保持精度，且参考值不依赖被测合约的 mulDiv 实现。
            // forge-lint: disable-next-line(divide-before-multiply)
            expected = (allocation / 24) * installments + (allocation % 24) * installments / 24;
        }

        uint256 timestamp = varied.start() + elapsedMonths * varied.MONTH() + offset;
        assertEq(varied.vestedAmount(timestamp), expected);
        assertLe(varied.vestedAmount(timestamp), allocation);
        assertEq(varied.vestedAmount(varied.start() - 1), 0);
    }
}

/// @notice 只用于测试的 ERC20，在开关打开后于转账中重入调用者的 release。
contract ReentrantToken is ERC20 {
    bool private reentryEnabled;

    /// @notice 为独立重入测试铸造 100 万枚，不能用于真实发行。
    constructor() ERC20("Reentrant Test Token", "RTT") {
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice 测试注资完成后开启回调，避免在初始化转账时触发重入。
    function enableReentry() external {
        reentryEnabled = true;
    }

    /// @notice 完成实际转账后重入 Vesting；验证即使发生回调也不会超额支付。
    function transfer(address to, uint256 amount) public override returns (bool) {
        bool success = super.transfer(to, amount);
        if (reentryEnabled) {
            LinearVesting(msg.sender).release();
        }
        return success;
    }
}
