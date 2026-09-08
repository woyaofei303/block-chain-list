// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "remix_tests.sol";
import "../contracts/Bank.sol";
import "./BankDepositor.sol";

contract BankTest {
    Bank private bank;
    BankDepositor private a;
    BankDepositor private b;
    BankDepositor private c;
    BankDepositor private d;
    bool private rejectPayment;
    bool private reenter;
    bool private reentryAttempted;
    bytes private reentryResult;

    function beforeAll() public {
        a = new BankDepositor();
        b = new BankDepositor();
        c = new BankDepositor();
        d = new BankDepositor();
    }

    function beforeEach() public {
        bank = new Bank();
        rejectPayment = false;
        reenter = false;
        reentryAttempted = false;
        delete reentryResult;
    }

    receive() external payable {
        require(!rejectPayment, "Receiver rejected ETH");
        if (reenter) {
            reentryAttempted = true;
            (bool success, bytes memory result) = address(bank).call(abi.encodeCall(Bank.withdraw, ()));
            require(!success, "Reentry unexpectedly succeeded");
            reentryResult = result;
        }
    }

    function initialState() public {
        Assert.equal(bank.admin(), address(this), "Deployer is admin");
        Assert.equal(bank.deposits(address(a)), uint256(0), "New account has no deposits");
        Assert.equal(address(bank).balance, uint256(0), "Bank starts empty");
        _assertRanking(address(0), address(0), address(0));
    }

    /// #value: 6
    function bothDepositEntrancesAccumulate() public payable {
        a.deposit{value: 2}(bank, false);
        a.deposit{value: 4}(bank, true);
        Assert.equal(bank.deposits(address(a)), uint256(6), "Both entrances accumulate");
        Assert.equal(address(bank).balance, uint256(6), "ETH reaches Bank");
        _assertRanking(address(a), address(0), address(0));
    }

    /// #value: 12
    function rankingAndTies() public payable {
        a.deposit{value: 1}(bank, false);
        b.deposit{value: 2}(bank, false);
        _assertRanking(address(b), address(a), address(0));
        c.deposit{value: 3}(bank, false);
        _assertRanking(address(c), address(b), address(a));
        d.deposit{value: 2}(bank, false);
        _assertRanking(address(c), address(b), address(d));
        a.deposit{value: 1}(bank, false);
        _assertRanking(address(c), address(b), address(d));
        a.deposit{value: 1}(bank, false);
        _assertRanking(address(c), address(a), address(b));
        a.deposit{value: 2}(bank, false);
        _assertRanking(address(a), address(c), address(b));
        Assert.equal(bank.deposits(address(a)), uint256(5), "Cumulative amount drives ranking");
    }

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

    function zeroDepositsAndEmptyWithdrawalFail() public {
        _expectRevert(address(bank), abi.encodeCall(Bank.deposit, ()), "Deposit must be positive");
        _expectRevert(address(bank), "", "Deposit must be positive");
        _expectRevert(address(bank), abi.encodeCall(Bank.withdraw, ()), "Nothing to withdraw");
        _assertRanking(address(0), address(0), address(0));
    }

    /// #value: 5
    function unauthorizedWithdrawalFails() public payable {
        a.deposit{value: 5}(bank, false);
        _expectRevert(address(a), abi.encodeCall(BankDepositor.withdraw, (bank)), "Only admin");
        Assert.equal(address(bank).balance, uint256(5), "Unauthorized call preserves funds");
        Assert.equal(bank.deposits(address(a)), uint256(5), "Unauthorized call preserves history");
    }

    /// #value: 9
    function withdrawalPreservesHistoryAndAllowsNewDeposits() public payable {
        a.deposit{value: 5}(bank, false);
        b.deposit{value: 3}(bank, false);
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

    function _expectRevert(address target, bytes memory data, string memory reason) private {
        (bool success, bytes memory result) = target.call(data);
        Assert.ok(!success, "Call must revert");
        Assert.equal(
            keccak256(result), keccak256(abi.encodeWithSignature("Error(string)", reason)), "Revert reason"
        );
    }
}
