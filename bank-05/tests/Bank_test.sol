// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// 断言库由 Remix Solidity Unit Testing 插件注入，无需安装本地依赖。
import "remix_tests.sol";
import "../contracts/Bank.sol";
import "./BankDepositor.sol";

// 测试合约创建 Bank，因此它是管理员；a、b、c、d 是四个独立存款人。
// 下方 /// #value 是 Remix 的测试交易配置，单位 Wei，不要当普通注释删除。
contract BankTest {
    Bank private bank;
    BankDepositor private a;
    BankDepositor private b;
    BankDepositor private c;
    BankDepositor private d;
    // 控制管理员收款回调，分别模拟收款失败和重入提款。
    bool private rejectPayment;
    bool private reenter;
    bool private reentryAttempted;
    bytes private reentryResult;

    // Remix 在整组测试前执行一次：创建四个可复用的调用地址。
    function beforeAll() public {
        a = new BankDepositor();
        b = new BankDepositor();
        c = new BankDepositor();
        d = new BankDepositor();
    }

    // 每项测试前创建全新 Bank 并重置回调状态，避免余额和排名相互影响。
    function beforeEach() public {
        bank = new Bank();
        rejectPayment = false;
        reenter = false;
        reentryAttempted = false;
        delete reentryResult;
    }

    // Bank 向管理员转账时执行此回调；正常情况直接收款。
    receive() external payable {
        require(!rejectPayment, "Receiver rejected ETH");
        if (reenter) {
            reentryAttempted = true;
            // 低级调用捕获内层失败，允许外层提款继续；保存错误数据供测试核对。
            (bool success, bytes memory result) = address(bank).call(abi.encodeCall(Bank.withdraw, ()));
            require(!success, "Reentry unexpectedly succeeded");
            reentryResult = result;
        }
    }

    // 验证部署时的管理员、零余额、默认记账和三个空榜位。
    function initialState() public {
        Assert.equal(bank.admin(), address(this), "Deployer is admin");
        Assert.equal(bank.deposits(address(a)), uint256(0), "New account has no deposits");
        Assert.equal(address(bank).balance, uint256(0), "Bank starts empty");
        _assertRanking(address(0), address(0), address(0));
    }

    // 同一人先显式存 2 Wei，再直接转入 4 Wei，两条入口应累计为 6 Wei。
    /// #value: 6
    function bothDepositEntrancesAccumulate() public payable {
        a.deposit{value: 2}(bank, false);
        a.deposit{value: 4}(bank, true);
        Assert.equal(bank.deposits(address(a)), uint256(6), "Both entrances accumulate");
        Assert.equal(address(bank).balance, uint256(6), "ETH reaches Bank");
        _assertRanking(address(a), address(0), address(0));
    }

    // 覆盖填榜、替换第三名、同额不越位，以及榜外地址连续上升。
    /// #value: 12
    function rankingAndTies() public payable {
        a.deposit{value: 1}(bank, false);
        b.deposit{value: 2}(bank, false);
        _assertRanking(address(b), address(a), address(0));
        c.deposit{value: 3}(bank, false);
        _assertRanking(address(c), address(b), address(a));
        // D 的 2 超过 A 的 1，但等于 B 的 2，因此排在 B 后面。
        d.deposit{value: 2}(bank, false);
        _assertRanking(address(c), address(b), address(d));
        // A 累计为 2 时不能挤掉 D；累计为 3 时入榜，但不能越过同额的 C。
        a.deposit{value: 1}(bank, false);
        _assertRanking(address(c), address(b), address(d));
        a.deposit{value: 1}(bank, false);
        _assertRanking(address(c), address(a), address(b));
        a.deposit{value: 2}(bank, false);
        _assertRanking(address(a), address(c), address(b));
        Assert.equal(bank.deposits(address(a)), uint256(5), "Cumulative amount drives ranking");
    }

    // 已在榜内的 C 追加存款只调整原位置，不能在数组中出现两次。
    /// #value: 16
    function existingMemberMovesWithoutDuplicates() public payable {
        a.deposit{value: 3}(bank, false);
        b.deposit{value: 2}(bank, false);
        c.deposit{value: 1}(bank, false);
        c.deposit{value: 1}(bank, false);
        _assertRanking(address(a), address(b), address(c));
        c.deposit{value: 2}(bank, false);
        _assertRanking(address(c), address(a), address(b));
        c.deposit{value: 1}(bank, false);
        _assertRanking(address(c), address(a), address(b));
        d.deposit{value: 6}(bank, false);
        _assertRanking(address(d), address(c), address(a));
    }

    // 空数据调用走 receive()，编码后的调用走 deposit()；两者都拒绝零金额。
    function zeroDepositsAndEmptyWithdrawalFail() public {
        _expectRevert(address(bank), abi.encodeCall(Bank.deposit, ()), "Deposit must be positive");
        _expectRevert(address(bank), "", "Deposit must be positive");
        _expectRevert(address(bank), abi.encodeCall(Bank.withdraw, ()), "Nothing to withdraw");
        _assertRanking(address(0), address(0), address(0));
    }

    // 存过款不代表有提款权限；辅助合约 A 的提款应失败且不改变资金与历史。
    /// #value: 5
    function unauthorizedWithdrawalFails() public payable {
        a.deposit{value: 5}(bank, false);
        _expectRevert(address(a), abi.encodeCall(BankDepositor.withdraw, (bank)), "Only admin");
        Assert.equal(address(bank).balance, uint256(5), "Unauthorized call preserves funds");
        Assert.equal(bank.deposits(address(a)), uint256(5), "Unauthorized call preserves history");
    }

    // 先存入 8 Wei 并全部提回，再存 1 Wei，验证实际余额和累计历史的区别。
    /// #value: 9
    function withdrawalPreservesHistoryAndAllowsNewDeposits() public payable {
        a.deposit{value: 5}(bank, false);
        b.deposit{value: 3}(bank, false);
        // 比较管理员合约的余额增量；测试交易的 Gas 由外层发送账户支付。
        uint256 balanceBefore = address(this).balance;
        bank.withdraw();
        Assert.equal(address(this).balance, balanceBefore + 8, "Admin receives every wei");
        Assert.equal(address(bank).balance, uint256(0), "Bank is empty after withdrawal");
        Assert.equal(bank.deposits(address(a)), uint256(5), "A history remains");
        Assert.equal(bank.deposits(address(b)), uint256(3), "B history remains");
        _assertRanking(address(a), address(b), address(0));
        _expectRevert(address(bank), abi.encodeCall(Bank.withdraw, ()), "Nothing to withdraw");
        a.deposit{value: 1}(bank, true);
        Assert.equal(bank.deposits(address(a)), uint256(6), "New deposit continues history");
        Assert.equal(address(bank).balance, uint256(1), "Actual balance differs from history");
        bank.withdraw();
        Assert.equal(address(bank).balance, uint256(0), "Next withdrawal works");
    }

    // 管理员拒收会让提款整体回滚；恢复收款后可重试，证明锁没有卡在 true。
    /// #value: 5
    function rejectedPaymentRollsBackAndCanRetry() public payable {
        a.deposit{value: 5}(bank, false);
        rejectPayment = true;
        _expectRevert(address(bank), abi.encodeCall(Bank.withdraw, ()), "Withdrawal failed");
        Assert.equal(address(bank).balance, uint256(5), "Rejected transfer preserves funds");
        Assert.equal(bank.deposits(address(a)), uint256(5), "Rejected transfer preserves history");
        _assertRanking(address(a), address(0), address(0));
        rejectPayment = false;
        bank.withdraw();
        Assert.equal(address(bank).balance, uint256(0), "Reverted lock permits retry");
    }

    // 管理员回调本身有提款权限，必须确实由重入锁阻止，而非碰巧余额不足。
    /// #value: 5
    function reentrantWithdrawalIsBlocked() public payable {
        a.deposit{value: 5}(bank, false);
        reenter = true;
        bank.withdraw();
        Assert.ok(reentryAttempted, "Admin receiver attempted reentry");
        Assert.equal(
            keccak256(reentryResult),
            keccak256(abi.encodeWithSignature("Error(string)", "Reentrant withdrawal")),
            "Reentry fails specifically at the lock"
        );
        Assert.equal(address(bank).balance, uint256(0), "Outer withdrawal succeeds");
        Assert.equal(bank.deposits(address(a)), uint256(5), "History remains after reentry attempt");
    }

    // 同时核对预期顺序、公开数组查询和累计金额查询，防止两个读取接口不一致。
    function _assertRanking(address first, address second, address third) private {
        (address[3] memory accounts, uint256[3] memory amounts) = bank.getTop3();
        Assert.equal(accounts[0], first, "First place");
        Assert.equal(accounts[1], second, "Second place");
        Assert.equal(accounts[2], third, "Third place");
        for (uint256 i = 0; i < 3; i++) {
            Assert.equal(bank.top3(i), accounts[i], "Public array matches snapshot");
            Assert.equal(amounts[i], bank.deposits(accounts[i]), "Ranking amount matches ledger");
        }
    }

    // 捕获预期失败，避免整个测试函数提前回退；同时核对失败原因。
    // require(false, reason) 返回 Error(string) 编码，比较其哈希即可比较完整数据。
    function _expectRevert(address target, bytes memory data, string memory reason) private {
        (bool success, bytes memory result) = target.call(data);
        Assert.ok(!success, "Call must revert");
        Assert.equal(
            keccak256(result), keccak256(abi.encodeWithSignature("Error(string)", reason)), "Revert reason"
        );
    }
}
