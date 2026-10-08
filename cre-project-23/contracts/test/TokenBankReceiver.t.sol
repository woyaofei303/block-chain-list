// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseERC20} from "tokenbank/contracts/BaseERC20.sol";
import {TokenBank} from "tokenbank/contracts/TokenBank.sol";
import {TokenBankReceiver} from "../evm/src/TokenBankReceiver.sol";
import {SwitchableToken} from "tokenbank/tests/TokenBankHelpers.sol";
import {ReceiverTemplate} from "../evm/src/ReceiverTemplate.sol";

interface Vm {
    /// @notice 仅替换下一次调用的 sender，用于本地权限检查。
    function prank(address sender) external;
    /// @notice 下一次调用必须以给定错误数据回滚。
    function expectRevert(bytes calldata reason) external;
    /// @notice 模拟新交易的冷账户和冷存储读取，避免 gas 上限检查低估成本。
    function cool(address target) external;
}

/// @notice 验证 CRE Receiver 的 Forwarder 入口、阈值判断和银行半额划转。
contract TokenBankReceiverTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice 相同报告不能在余额仍高于阈值时再次划走资产。
    function testRepeatedReportCannotWithdrawAgain() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        address forwarder = address(0xF0);
        TokenBankReceiver receiver = new TokenBankReceiver(forwarder, address(bank), address(0xBEEF), 100);
        bank.setAutomationReceiver(address(receiver));
        token.approve(address(bank), 400);
        bank.deposit(400);
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(uint256(1)));
        vm.prank(forwarder);
        (bool ok,) = address(receiver).call(abi.encodeCall(receiver.onReport, (bytes(""), abi.encode(uint256(1)))));
        require(!ok, "replayed report must fail");
        require(bank.totalDeposits() == 200, "replay preserves deposits");
    }

    /// @notice 模拟用户 approve + deposit，再由 Forwarder 触发半额提款。
    function testForwarderWithdrawsHalfAndKeepsLedgerBacked() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        address forwarder = address(0xF0);
        address recipient = address(0xBEEF);
        TokenBankReceiver receiver = new TokenBankReceiver(forwarder, address(bank), recipient, 50);

        bank.setAutomationReceiver(address(receiver));
        token.approve(address(bank), 100);
        bank.deposit(100);
        require(receiver.needsUpkeep(), "threshold should trigger");

        vm.prank(forwarder);
        receiver.onReport("", abi.encode(uint256(1)));

        require(token.balanceOf(recipient) == 50, "recipient half balance");
        require(token.balanceOf(address(bank)) == 50, "bank asset balance");
        require(bank.totalDeposits() == 50, "bank total ledger");
        require(bank.balances(address(this)) == 50, "user claim remains backed");
        require(!receiver.needsUpkeep(), "threshold should stop after sweep");
    }

    /// @notice 验证非 Forwarder 不能伪造 CRE 报告触发资金操作。
    function testOnlyForwarderCanReport() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        TokenBankReceiver receiver = new TokenBankReceiver(address(0xF0), address(bank), address(0xBEEF), 1);

        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, address(this), address(0xF0)));
        receiver.onReport("", abi.encode(uint256(1)));
        require(bank.totalDeposits() == 0, "bank stays unchanged");
    }

    /// @notice 验证低于阈值时，Forwarder 报告也不能划转资产。
    function testThresholdIsRecheckedBeforeWrite() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        address forwarder = address(0xF0);
        TokenBankReceiver receiver = new TokenBankReceiver(forwarder, address(bank), address(0xBEEF), 100);
        bank.setAutomationReceiver(address(receiver));
        token.approve(address(bank), 100);
        bank.deposit(100);

        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Threshold not met"));
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(uint256(1)));
        require(token.balanceOf(address(bank)) == 100, "bank assets stay put");
    }

    /// @notice 用户缺少授权时全回滚；存取款后总账归零，直接转币不产生个人存款。
    function testDepositWithdrawAndDirectTransfer() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "ERC20: transfer amount exceeds allowance"));
        bank.deposit(10);
        require(bank.totalDeposits() == 0 && token.balanceOf(address(bank)) == 0, "unapproved rollback");
        token.approve(address(bank), 10);
        bank.deposit(10);
        bank.withdraw(4);
        require(bank.totalDeposits() == 6 && bank.balances(address(this)) == 6, "withdraw ledger");
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Insufficient deposited balance"));
        bank.withdraw(7);
        bank.withdraw(6);
        token.transfer(address(bank), 5);
        require(bank.totalDeposits() == 0 && token.balanceOf(address(bank)) == 5, "direct transfer is not deposit");
    }

    /// @notice 校验管理权限及非法收款人，禁止转给银行自己造成空扣账。
    function testBankPermissionsAndRecipientValidation() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Not authorized"));
        vm.prank(address(0xBAD));
        bank.withdrawhalf(address(this));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Only owner"));
        vm.prank(address(0xBAD));
        bank.setAutomationReceiver(address(this));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Invalid recipient"));
        bank.withdrawhalf(address(bank));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Invalid recipient"));
        bank.withdrawhalf(address(0));
    }

    /// @notice 随机三人余额包含奇数/极小金额；总扣款精确等于 floor(total/2)，余款全可提。
    function testFuzzHalfRoundingKeepsEveryClaimBacked(uint64 a, uint64 b, uint64 c) public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        uint256[3] memory amounts = [uint256(a) + 1, uint256(b) + 1, uint256(c) + 1];
        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            address user = address(uint160(i + 100));
            token.transfer(user, amounts[i]);
            vm.prank(user);
            token.approve(address(bank), amounts[i]);
            vm.prank(user);
            bank.deposit(amounts[i]);
            total += amounts[i];
        }
        bank.withdrawhalf(address(0xBEEF));
        require(token.balanceOf(address(0xBEEF)) == total / 2, "exact floor half");
        uint256 claims;
        for (uint256 i; i < amounts.length; i++) {
            address user = address(uint160(i + 100));
            uint256 balance = bank.balances(user);
            require(balance >= amounts[i] / 2 && balance <= (amounts[i] + 1) / 2, "fair rounding");
            claims += balance;
            if (balance > 0) {
                vm.prank(user);
                bank.withdraw(balance);
            }
        }
        require(claims == total - total / 2, "sum claims");
        require(bank.totalDeposits() == 0 && token.balanceOf(address(bank)) == 0, "all claims redeemed");
    }

    /// @notice ERC20 返回 false 时撤销序号和扣账，恢复代币后同一报告可重试。
    function testTransferFailureRollsBackNonceAndLedger() public {
        SwitchableToken token = new SwitchableToken();
        TokenBank bank = new TokenBank(address(token));
        TokenBankReceiver receiver = new TokenBankReceiver(address(0xF0), address(bank), address(0xBEEF), 100);
        bank.setAutomationReceiver(address(receiver));
        token.setSucceeds(true);
        bank.deposit(400);
        token.setSucceeds(false);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Token transfer failed"));
        vm.prank(address(0xF0));
        receiver.onReport("", abi.encode(uint256(1)));
        require(receiver.nextNonce() == 1 && bank.totalDeposits() == 400, "atomic rollback");
        require(bank.balances(address(this)) == 400, "user rollback");
        token.setSucceeds(true);
        vm.prank(address(0xF0));
        receiver.onReport("", abi.encode(uint256(1)));
        require(receiver.nextNonce() == 2 && bank.totalDeposits() == 200, "retry succeeds");
    }

    /// @notice 固定 Forwarder 检查不因模板 setter 关闭；启用 workflow ID 后拒绝其他工作流。
    function testForwarderAndWorkflowIdentityStayEnforced() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        TokenBankReceiver receiver = new TokenBankReceiver(address(0xF0), address(bank), address(0xBEEF), 10);
        receiver.setForwarderAddress(address(0));
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Untrusted forwarder"));
        receiver.onReport("", abi.encode(uint256(1)));
        receiver.setForwarderAddress(address(0xF0));
        receiver.setExpectedWorkflowId(bytes32(uint256(123)));
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, bytes32(0), bytes32(uint256(123)))
        );
        vm.prank(address(0xF0));
        receiver.onReport(new bytes(64), abi.encode(uint256(1)));
        bank.setAutomationReceiver(address(receiver));
        token.approve(address(bank), 20);
        bank.deposit(20);
        vm.prank(address(0xF0));
        // 生产 Forwarder metadata 为 64 字节，最后两个字节是 reportId。
        receiver.onReport(
            abi.encodePacked(bytes32(uint256(123)), bytes10(0), address(this), bytes2(0)), abi.encode(uint256(1))
        );
        require(bank.totalDeposits() == 10, "authorized workflow succeeds");
    }

    /// @notice 100 人的最坏扫描仍在 workflow gas 预算内；第 101 位用户失败且资产回滚。
    function testDepositorCapAndWorstCaseGas() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        TokenBankReceiver receiver = new TokenBankReceiver(address(0xF0), address(bank), address(0xBEEF), 1);
        bank.setAutomationReceiver(address(receiver));
        for (uint256 i; i < bank.MAX_DEPOSITORS(); i++) {
            address user = address(uint160(i + 100));
            token.transfer(user, 3);
            vm.prank(user);
            token.approve(address(bank), 3);
            vm.prank(user);
            bank.deposit(3);
        }
        token.approve(address(bank), 1);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Depositor limit"));
        bank.deposit(1);
        require(bank.totalDeposits() == 300, "cap rollback");
        vm.cool(address(bank));
        vm.cool(address(token));
        vm.cool(address(receiver));
        vm.prank(address(0xF0));
        uint256 beforeGas = gasleft();
        receiver.onReport("", abi.encode(uint256(1)));
        require(beforeGas - gasleft() < 1500000, "workflow gas budget");
        require(bank.totalDeposits() == 150, "maximum-size sweep");
    }

    /// @notice uint256 最大账本也能减半，不能因中间乘法溢出而锁死存款。
    function testMaximumUintBalanceCanBeHalved() public {
        SwitchableToken token = new SwitchableToken();
        TokenBank bank = new TokenBank(address(token));
        token.setSucceeds(true);
        bank.deposit(type(uint256).max);
        uint256 amount = bank.withdrawhalf(address(0xBEEF));
        require(amount == type(uint256).max / 2, "max half");
        require(bank.totalDeposits() == type(uint256).max - amount, "max remaining");
    }

    /// @notice 恶意 Token 在存入、个人提款和半额划转时均不能跨入口重入账本。
    function testTokenCallbacksCannotReenterMoneyPaths() public {
        ReentrantToken token = new ReentrantToken();
        TokenBank bank = new TokenBank(address(token));
        token.configure(bank);
        bank.setAutomationReceiver(address(token));
        bank.deposit(100);
        bank.withdrawhalf(address(0xBEEF));
        bank.withdraw(50);
        require(bank.totalDeposits() == 0, "callbacks preserve ledger");
        require(token.blockedCalls() == 9, "all three paths blocked in each transfer");
    }
}

/// @notice 仅测试重入锁的 Token 替身，不模拟真实资产发行。
contract ReentrantToken {
    TokenBank private bank;
    uint256 public blockedCalls;

    /// @notice 绑定本轮测试银行。
    function configure(TokenBank target) external {
        bank = target;
    }

    /// @notice 存入转账期间尝试三个资金入口，之后返回成功。
    function transferFrom(address, address, uint256) external returns (bool) {
        _attempt();
        return true;
    }

    /// @notice 提款转账期间尝试三个资金入口，之后返回成功。
    function transfer(address, uint256) external returns (bool) {
        _attempt();
        return true;
    }

    /// @notice 校验每个失败都来自重入锁，而非授权不足或余额不足。
    function _attempt() private {
        bytes[3] memory calls = [
            abi.encodeCall(bank.deposit, (1)),
            abi.encodeCall(bank.withdraw, (1)),
            abi.encodeCall(bank.withdrawhalf, (address(0xBEEF)))
        ];
        for (uint256 i; i < calls.length; i++) {
            (bool ok, bytes memory reason) = address(bank).call(calls[i]);
            require(
                !ok && keccak256(reason) == keccak256(abi.encodeWithSignature("Error(string)", "Reentrancy")),
                "expected reentrancy guard"
            );
            blockedCalls++;
        }
    }
}
