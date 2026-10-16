// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/IERC6093.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CallOptionToken} from "../src/CallOptionToken.sol";
import {MockUSDT} from "../src/MockUSDT.sol";

/// @notice 模拟拒收 ETH 或在收款时重入的合约账户。
contract Receiver {
    CallOptionToken public option;
    bool public rejectETH;
    bool public reenter;
    bool public reentryBlocked;

    /// @notice 测试专用开关，不作为生产合约部署。
    function configure(CallOptionToken option_, bool rejectETH_, bool reenter_) external {
        option = option_;
        rejectETH = rejectETH_;
        reenter = reenter_;
    }

    /// @notice 根据测试场景拒收，或确认重入被同一入口的锁阻止。
    receive() external payable {
        require(!rejectETH, "ETH rejected");
        if (reenter) {
            try option.exercise(1) {
                revert("reentry succeeded");
            } catch (bytes memory reason) {
                require(bytes4(reason) == ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "wrong error");
                reentryBlocked = true;
            }
        }
    }
}

/// @notice 模拟转账扣费或返回 false 的支付币。
contract BadPayment is ERC20 {
    bool public returnFalse;

    /// @notice 固定用户余额，仅用于验证支付失败时的原子回滚。
    constructor(address user, bool returnFalse_) ERC20("Bad Payment", "BAD") {
        _mint(user, 10_000e6);
        returnFalse = returnFalse_;
    }

    /// @notice 收款后扣掉一个最小单位，或直接拒绝转账。
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (returnFalse) return false;
        super.transferFrom(from, to, value);
        _burn(to, 1);
        return true;
    }
}

/// @notice 模拟不返回 bool 的旧式支付币，验证 SafeERC20 的兼容路径。
contract NoReturnPayment {
    mapping(address => uint256) public balanceOf;

    /// @notice 预置测试资金，模拟币不用于生产。
    constructor(address user) {
        balanceOf[user] = 10_000e6;
    }

    /// @notice 测试桩只验证返回值兼容性，故意省略授权账本。
    function transferFrom(address from, address to, uint256 value) external {
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }

    /// @notice 到期退款同样不返回 bool。
    function transfer(address to, uint256 value) external {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
    }
}

/// @notice 覆盖抵押守恒、时间、权限、支付兼容性、回滚与到期批处理。
contract CallOptionTokenTest is Test {
    address private issuer = makeAddr("issuer");
    address private alice = makeAddr("alice");
    address private bob = makeAddr("bob");
    uint256 private constant START = 200 days;
    MockUSDT private usdt;
    CallOptionToken private option;

    /// @notice 每个用例独立拥有 2 ETH 抵押，Alice 和发行方各持 1 枚期权。
    function setUp() public {
        vm.warp(START - 2 days);
        vm.deal(issuer, 10 ether);
        usdt = new MockUSDT(alice, 10_000e6);
        vm.startPrank(issuer);
        option = new CallOptionToken(usdt, 2000e6, START);
        option.issue{value: 2 ether}();
        option.transfer(alice, 1 ether);
        vm.stopPrank();
        vm.prank(alice);
        usdt.approve(address(option), type(uint256).max);
    }

    /// @notice 合约条款和精度固定，发行量必须等于入金。
    function testTermsAndCollateral() public view {
        assertEq(option.issuer(), issuer);
        assertEq(address(option.paymentToken()), address(usdt));
        assertEq(option.strikePrice(), 2000e6);
        assertEq(option.exerciseStart(), START);
        assertEq(option.exerciseEnd(), START + 1 days);
        assertEq(option.decimals(), 18);
        assertEq(usdt.decimals(), 6);
        assertEq(option.totalSupply(), 2 ether);
        assertEq(address(option).balance, 2 ether);
        assertEq(option.remainingHolders(), 2);
    }

    /// @notice 拒绝无代码支付币、零价、过去日期和非 UTC 零点。
    function testInvalidTerms() public {
        vm.expectRevert(CallOptionToken.InvalidTerms.selector);
        new CallOptionToken(IERC20(address(0)), 2000e6, START);
        vm.expectRevert(CallOptionToken.InvalidTerms.selector);
        new CallOptionToken(IERC20(alice), 2000e6, START);
        vm.expectRevert(CallOptionToken.InvalidTerms.selector);
        new CallOptionToken(usdt, 0, START);
        vm.expectRevert(CallOptionToken.InvalidTerms.selector);
        new CallOptionToken(usdt, 2000e6, START - 2 days);
        vm.expectRevert(CallOptionToken.InvalidTerms.selector);
        new CallOptionToken(usdt, 2000e6, START + 1);
    }

    /// @notice 非发行方不能发行或到期提取，失败时不改变资金。
    function testOnlyIssuerCanIssueOrExpire() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(CallOptionToken.OnlyIssuer.selector);
        option.issue{value: 1 ether}();
        vm.warp(option.exerciseEnd());
        vm.prank(alice);
        vm.expectRevert(CallOptionToken.OnlyIssuer.selector);
        option.expire(10);
        assertEq(address(option).balance, 2 ether);
    }

    /// @notice 发行截止在行权日零点，零入金同样无效。
    function testIssuanceBoundaries() public {
        vm.startPrank(issuer);
        vm.expectRevert(CallOptionToken.ZeroAmount.selector);
        option.issue();
        vm.warp(START - 1);
        option.issue{value: 1 wei}();
        vm.warp(START);
        vm.expectRevert(CallOptionToken.IssuanceClosed.selector);
        option.issue{value: 1 wei}();
        vm.stopPrank();
        assertEq(option.totalSupply(), 2 ether + 1);
        assertEq(address(option).balance, 2 ether + 1);
    }

    /// @notice 0.4 枚消耗 800 USDT，用户得到 0.4 ETH，余下抵押仍覆盖余量。
    function testExerciseAtStart() public {
        vm.warp(START);
        vm.prank(alice);
        option.exercise(0.4 ether);
        assertEq(alice.balance, 0.4 ether);
        assertEq(usdt.balanceOf(alice), 9200e6);
        assertEq(usdt.balanceOf(address(option)), 800e6);
        assertEq(option.balanceOf(alice), 0.6 ether);
        assertEq(option.totalSupply(), 1.6 ether);
        assertEq(address(option).balance, 1.6 ether);
    }

    /// @notice 到期日最后一秒允许行权，前一秒与次日零点均拒绝。
    function testExerciseWindowEdges() public {
        vm.startPrank(alice);
        vm.warp(START - 1);
        vm.expectRevert(CallOptionToken.OutsideExerciseWindow.selector);
        option.exercise(0.1 ether);
        vm.warp(START + 1 days - 1);
        option.exercise(0.1 ether);
        vm.warp(START + 1 days);
        vm.expectRevert(CallOptionToken.OutsideExerciseWindow.selector);
        option.exercise(0.1 ether);
        vm.stopPrank();
        assertEq(option.balanceOf(alice), 0.9 ether);
    }

    /// @notice 不能零额行权或销毁超过自身余额的期权。
    function testInvalidExerciseAmounts() public {
        vm.warp(START);
        vm.startPrank(alice);
        vm.expectRevert(CallOptionToken.ZeroAmount.selector);
        option.exercise(0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 1 ether, 2 ether));
        option.exercise(2 ether);
        vm.stopPrank();
        assertEq(address(option).balance, 2 ether);
    }

    /// @notice 1 wei 期权也至少支付一个 USDT 最小单位，防止舍入到免费。
    function testQuoteRoundsUpAndTinyExercise() public {
        assertEq(option.quote(0), 0);
        assertEq(option.quote(1), 1);
        assertEq(option.quote(1 ether), 2000e6);
        assertEq(option.quote(1 ether + 1), 2000e6 + 1);
        vm.warp(START);
        vm.prank(alice);
        option.exercise(1);
        assertEq(alice.balance, 1);
        assertEq(usdt.balanceOf(address(option)), 1);
    }

    /// @notice 支付币授权不足时，先发生的期权销毁也必须回滚。
    function testInsufficientPaymentAllowanceRollsBack() public {
        vm.warp(START);
        vm.startPrank(alice);
        usdt.approve(address(option), 799e6);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(option), 799e6, 800e6)
        );
        option.exercise(0.4 ether);
        vm.stopPrank();
        assertEq(option.balanceOf(alice), 1 ether);
        assertEq(usdt.allowance(alice, address(option)), 799e6);
        assertEq(address(option).balance, 2 ether);
    }

    /// @notice 授权足够但余额不足时，期权、付款和抵押都不改变。
    function testInsufficientPaymentBalanceRollsBack() public {
        vm.startPrank(alice);
        usdt.transfer(bob, 10_000e6);
        vm.warp(START);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 800e6));
        option.exercise(0.4 ether);
        vm.stopPrank();
        assertEq(option.balanceOf(alice), 1 ether);
        assertEq(usdt.balanceOf(address(option)), 0);
    }

    /// @notice ETH 接收方拒收时，付款、授权扣减和期权销毁必须全部恢复。
    function testETHRejectionRollsBackExercise() public {
        Receiver receiver = new Receiver();
        receiver.configure(option, true, false);
        vm.startPrank(alice);
        option.transfer(address(receiver), 1 ether);
        usdt.transfer(address(receiver), 2000e6);
        vm.stopPrank();
        vm.warp(START);
        vm.startPrank(address(receiver));
        usdt.approve(address(option), 2000e6);
        vm.expectRevert(CallOptionToken.ETHTransferFailed.selector);
        option.exercise(1 ether);
        vm.stopPrank();
        assertEq(option.balanceOf(address(receiver)), 1 ether);
        assertEq(usdt.balanceOf(address(receiver)), 2000e6);
        assertEq(usdt.allowance(address(receiver), address(option)), 2000e6);
        assertEq(usdt.balanceOf(address(option)), 0);
        assertEq(address(option).balance, 2 ether);
    }

    /// @notice 用户收 ETH 时不能再次进入行权，正常外层交易仍能完成。
    function testExerciseReentrancyBlocked() public {
        Receiver receiver = new Receiver();
        receiver.configure(option, false, true);
        vm.startPrank(alice);
        option.transfer(address(receiver), 1 ether);
        usdt.transfer(address(receiver), 2000e6);
        vm.stopPrank();
        vm.warp(START);
        vm.startPrank(address(receiver));
        usdt.approve(address(option), 2000e6);
        option.exercise(0.5 ether);
        vm.stopPrank();
        assertTrue(receiver.reentryBlocked());
        assertEq(address(receiver).balance, 0.5 ether);
        assertEq(option.balanceOf(address(receiver)), 0.5 ether);
    }

    /// @notice 到期销毁逐户发出标准 Transfer，最终退回 1.6 ETH 与 800 USDT。
    function testExpiryBurnsEveryHolderAndReturnsProceeds() public {
        vm.warp(START);
        vm.prank(alice);
        option.exercise(0.4 ether);
        vm.warp(option.exerciseEnd());
        vm.expectEmit(true, true, false, true, address(option));
        emit IERC20.Transfer(alice, address(0), 0.6 ether);
        vm.expectEmit(true, true, false, true, address(option));
        emit IERC20.Transfer(issuer, address(0), 1 ether);
        vm.prank(issuer);
        option.expire(10);
        assertEq(option.totalSupply(), 0);
        assertEq(option.balanceOf(alice), 0);
        assertEq(option.balanceOf(issuer), 0);
        assertEq(issuer.balance, 9.6 ether);
        assertEq(usdt.balanceOf(issuer), 800e6);
        assertEq(address(option).balance, 0);
        assertEq(option.remainingHolders(), 0);
    }

    /// @notice 到期前禁止回收；零批量和重复回收也有明确错误。
    function testExpiryBoundaries() public {
        vm.startPrank(issuer);
        vm.warp(option.exerciseEnd() - 1);
        vm.expectRevert(CallOptionToken.NotExpired.selector);
        option.expire(10);
        vm.warp(option.exerciseEnd());
        vm.expectRevert(CallOptionToken.ZeroAmount.selector);
        option.expire(0);
        option.expire(10);
        vm.expectRevert(CallOptionToken.NothingToExpire.selector);
        option.expire(10);
        vm.stopPrank();
    }

    /// @notice 每批只释放已销毁数量的抵押，未处理持有人仍有足额抵押。
    function testExpiryInBatches() public {
        vm.prank(alice);
        option.transfer(bob, 0.25 ether);
        vm.warp(option.exerciseEnd());
        vm.startPrank(issuer);
        option.expire(1);
        assertEq(option.balanceOf(bob), 0);
        assertEq(option.totalSupply(), 1.75 ether);
        assertEq(address(option).balance, 1.75 ether);
        assertEq(option.remainingHolders(), 2);
        option.expire(1);
        assertEq(option.totalSupply(), 1 ether);
        assertEq(address(option).balance, 1 ether);
        option.expire(1);
        vm.stopPrank();
        assertEq(option.totalSupply(), 0);
        assertEq(issuer.balance, 10 ether);
    }

    /// @notice 已转空的历史账户可以清理，零额转账与自转账不重复登记。
    function testHolderTrackingAndEmptyBalances() public {
        vm.startPrank(alice);
        option.transfer(bob, 0);
        option.transfer(alice, 1 ether);
        assertEq(option.remainingHolders(), 2);
        option.transfer(bob, 1 ether);
        vm.stopPrank();
        vm.prank(bob);
        option.transfer(alice, 1 ether);
        assertEq(option.remainingHolders(), 3);
        vm.warp(option.exerciseEnd());
        vm.prank(issuer);
        option.expire(1);
        assertEq(option.remainingHolders(), 2);
        assertEq(address(option).balance, 2 ether);
        vm.prank(issuer);
        option.expire(2);
        assertEq(option.totalSupply(), 0);
    }

    /// @notice 到期禁止转账与代理转账，失败时授权扣减也回滚。
    function testExpiredTransfersCannotEscapeBurn() public {
        vm.prank(alice);
        option.approve(bob, 1 ether);
        vm.warp(option.exerciseEnd());
        vm.prank(alice);
        vm.expectRevert(CallOptionToken.TokenExpired.selector);
        option.transfer(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(CallOptionToken.TokenExpired.selector);
        option.transferFrom(alice, bob, 1 ether);
        assertEq(option.allowance(alice, bob), 1 ether);
        vm.prank(issuer);
        option.expire(10);
        vm.prank(alice);
        vm.expectRevert(CallOptionToken.TokenExpired.selector);
        option.transfer(bob, 0);
    }

    /// @notice 到期前的代理转账和零额转账保持 ERC20 行为，真实收款人进入清理列表。
    function testERC20TransferFrom() public {
        vm.prank(alice);
        option.approve(bob, 0.4 ether);
        vm.prank(bob);
        option.transferFrom(alice, bob, 0.4 ether);
        assertEq(option.balanceOf(bob), 0.4 ether);
        assertEq(option.allowance(alice, bob), 0);
        assertEq(option.remainingHolders(), 3);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        option.transfer(address(0), 1);
    }

    /// @notice 转账扣费币不能少付行权款，失败后先前销毁恢复。
    function testFeePaymentRejected() public {
        BadPayment payment = new BadPayment(alice, false);
        CallOptionToken target = _fundOption(payment);
        vm.warp(START);
        vm.startPrank(alice);
        payment.approve(address(target), 2000e6);
        vm.expectRevert(CallOptionToken.UnsupportedPaymentToken.selector);
        target.exercise(1 ether);
        vm.stopPrank();
        assertEq(target.balanceOf(alice), 1 ether);
        assertEq(payment.balanceOf(alice), 10_000e6);
        assertEq(payment.allowance(alice, address(target)), 2000e6);
        assertEq(address(target).balance, 1 ether);
    }

    /// @notice 返回 false 的代币由 SafeERC20 拒绝，不能免费取得抵押。
    function testFalseReturningPaymentRejected() public {
        BadPayment payment = new BadPayment(alice, true);
        CallOptionToken target = _fundOption(payment);
        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(payment)));
        target.exercise(1 ether);
        assertEq(target.totalSupply(), 1 ether);
        assertEq(address(target).balance, 1 ether);
    }

    /// @notice 不返回 bool 的支付币可行权，并在到期时把全部行权款给发行方。
    function testNoReturnPaymentWorks() public {
        NoReturnPayment payment = new NoReturnPayment(alice);
        CallOptionToken target = _fundOption(IERC20(address(payment)));
        vm.warp(START);
        vm.prank(alice);
        target.exercise(1 ether);
        vm.warp(target.exerciseEnd());
        vm.prank(issuer);
        target.expire(10);
        assertEq(payment.balanceOf(issuer), 2000e6);
        assertEq(target.totalSupply(), 0);
    }

    /// @notice 发行方拒收 ETH 时连同销毁和列表游标一起回滚，修复接收后可重试。
    function testIssuerRejectionRollsBackExpiry() public {
        Receiver receiver = new Receiver();
        vm.deal(address(receiver), 1 ether);
        vm.startPrank(address(receiver));
        CallOptionToken target = new CallOptionToken(usdt, 2000e6, START);
        target.issue{value: 1 ether}();
        target.transfer(alice, 1 ether);
        vm.stopPrank();
        receiver.configure(target, true, false);
        vm.warp(START);
        vm.startPrank(alice);
        usdt.approve(address(target), 1000e6);
        target.exercise(0.5 ether);
        vm.stopPrank();
        vm.warp(target.exerciseEnd());
        vm.prank(address(receiver));
        vm.expectRevert(CallOptionToken.ETHTransferFailed.selector);
        target.expire(10);
        assertEq(target.remainingHolders(), 2);
        assertEq(target.totalSupply(), 0.5 ether);
        assertEq(usdt.balanceOf(address(target)), 1000e6);
        assertEq(usdt.balanceOf(address(receiver)), 0);
        receiver.configure(target, false, false);
        vm.prank(address(receiver));
        target.expire(10);
        assertEq(target.totalSupply(), 0);
    }

    /// @notice 意外多出的 ETH 不能影响正常行权，最后一批会一并返还。
    function testSurplusETHReturnedInLastBatch() public {
        vm.deal(address(option), 3 ether);
        vm.warp(option.exerciseEnd());
        vm.startPrank(issuer);
        option.expire(1);
        assertEq(address(option).balance, 2 ether);
        option.expire(1);
        vm.stopPrank();
        assertEq(issuer.balance, 11 ether);
        assertEq(address(option).balance, 0);
    }

    /// @notice 随机行权数量下，用户收 ETH、合约抵押与总量始终一致。
    function testFuzzExerciseAndExpiry(uint256 amount) public {
        amount = bound(amount, 1, 1 ether);
        uint256 payment = option.quote(amount);
        vm.warp(START);
        vm.prank(alice);
        option.exercise(amount);
        assertEq(alice.balance, amount);
        assertEq(option.totalSupply(), 2 ether - amount);
        assertEq(address(option).balance, option.totalSupply());
        assertEq(usdt.balanceOf(address(option)), payment);
        vm.warp(option.exerciseEnd());
        vm.prank(issuer);
        option.expire(10);
        assertEq(issuer.balance, 10 ether - amount);
        assertEq(usdt.balanceOf(issuer), payment);
        assertEq(option.totalSupply(), 0);
        assertEq(address(option).balance, 0);
    }

    /// @notice 对随机 ETH 数量与行权价核对向上取整，乘积不溢出测试边界。
    function testFuzzQuote(uint128 amount, uint64 price) public {
        price = uint64(bound(price, 1, type(uint64).max));
        CallOptionToken target = new CallOptionToken(usdt, price, START);
        uint256 product = uint256(amount) * price;
        uint256 expected = product / 1 ether + (product % 1 ether == 0 ? 0 : 1);
        assertEq(target.quote(amount), expected);
    }

    /// @notice 为异常支付币测试建立独立的一枚期权，不污染默认夹具。
    function _fundOption(IERC20 payment) private returns (CallOptionToken target) {
        vm.startPrank(issuer);
        target = new CallOptionToken(payment, 2000e6, START);
        target.issue{value: 1 ether}();
        target.transfer(alice, 1 ether);
        vm.stopPrank();
    }
}
