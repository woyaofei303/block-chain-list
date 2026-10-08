// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// 由 Remix 的 Solidity Unit Testing 插件提供。
import "remix_tests.sol";
import "../contracts/BaseERC20.sol";
import "../contracts/TokenBank.sol";
import "./TokenBankHelpers.sol";

contract TokenBankTest {
    BaseERC20 private token;
    TokenBank private bank;
    TokenBankUser private bob;

    /// @notice 创建独立用户辅助合约，用于区分 msg.sender。
    function beforeAll() public {
        bob = new TokenBankUser();
    }

    /// @notice 每项测试使用全新的代币和银行，避免相互影响。
    function beforeEach() public {
        token = new BaseERC20();
        bank = new TokenBank(address(token));
    }

    /// @notice 检查发行、精度、授权与失败转账的原子回滚。
    function initialStateAndTokenRules() public {
        uint256 supply = 100_000_000 * 10 ** 18;
        Assert.equal(token.name(), "BaseERC20", "Token name");
        Assert.equal(token.symbol(), "BERC20", "Token symbol");
        Assert.equal(uint256(token.decimals()), uint256(18), "Token decimals");
        Assert.equal(token.totalSupply(), supply, "Scaled supply");
        Assert.equal(token.balanceOf(address(this)), supply, "Deployer receives supply");
        Assert.equal(bank.balances(address(this)), uint256(0), "Bank starts empty");

        token.transfer(address(this), 10);
        token.transfer(address(bob), 0);
        Assert.equal(token.balanceOf(address(this)), supply, "Self and zero transfers preserve balance");
        token.approve(address(this), 10);
        token.approve(address(this), 4);
        token.transferFrom(address(this), address(bob), 3);
        Assert.equal(token.allowance(address(this), address(this)), uint256(1), "Approve replaces; transferFrom spends");
        Assert.equal(token.balanceOf(address(bob)), uint256(3), "Recipient receives tokens");
        _expectRevert(
            address(token),
            abi.encodeCall(token.transferFrom, (address(this), address(bob), 2)),
            "ERC20: transfer amount exceeds allowance"
        );
        Assert.equal(token.balanceOf(address(bob)), uint256(3), "Failed transferFrom rolls back tokens");
        _expectRevert(
            address(token),
            abi.encodeCall(token.transfer, (address(bob), supply)),
            "ERC20: transfer amount exceeds balance"
        );
        _expectRevert(
            address(token), abi.encodeCall(token.transfer, (address(0), 1)), "ERC20: transfer to the zero address"
        );
    }

    /// @notice 检查累积存款、部分提款和全额提款的资产/账本一致性。
    function depositAndWithdraw() public {
        uint256 supply = token.totalSupply();
        token.approve(address(bank), 30);
        bank.deposit(20);
        bank.deposit(10);
        Assert.equal(bank.balances(address(this)), uint256(30), "Deposits accumulate");
        Assert.equal(token.balanceOf(address(bank)), uint256(30), "Bank receives tokens");
        Assert.equal(token.allowance(address(this), address(bank)), uint256(0), "Allowance is spent");

        bank.withdraw(10);
        Assert.equal(bank.balances(address(this)), uint256(20), "Partial withdrawal debits balance");
        Assert.equal(token.balanceOf(address(this)), supply - 20, "User receives tokens");
        bank.withdraw(20);
        Assert.equal(bank.balances(address(this)), uint256(0), "Full withdrawal clears balance");
        Assert.equal(token.balanceOf(address(bank)), uint256(0), "Bank releases tokens");
        Assert.equal(token.balanceOf(address(this)), supply, "All tokens return to user");
    }

    /// @notice bob 是独立调用者，用于验证用户之间的余额隔离。
    function authorizationAndUserIsolation() public {
        token.transfer(address(bob), 10);
        _expectRevert(address(bank), abi.encodeCall(bank.deposit, (1)), "ERC20: transfer amount exceeds allowance");
        Assert.equal(bank.balances(address(this)), uint256(0), "Failed deposit does not credit user");
        Assert.equal(token.balanceOf(address(bank)), uint256(0), "Failed deposit does not move tokens");

        token.approve(address(bank), 20);
        bank.deposit(20);
        _expectRevert(address(bob), abi.encodeCall(bob.withdraw, (bank, 1)), "Insufficient deposited balance");
        bob.approve(token, bank, 11);
        _expectRevert(address(bob), abi.encodeCall(bob.deposit, (bank, 11)), "ERC20: transfer amount exceeds balance");
        Assert.equal(token.allowance(address(bob), address(bank)), uint256(11), "Failed deposit preserves allowance");
        bob.deposit(bank, 10);

        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (21)), "Insufficient deposited balance");
        Assert.equal(bank.balances(address(this)), uint256(20), "Failed withdrawal preserves balance");
        Assert.equal(token.balanceOf(address(bank)), uint256(30), "Failed withdrawal preserves tokens");
        bank.withdraw(20);
        Assert.equal(bank.balances(address(bob)), uint256(10), "Other user balance is unchanged");
        Assert.equal(token.balanceOf(address(bank)), uint256(10), "Other user tokens remain");
        bob.withdraw(bank, 10);
        Assert.equal(token.balanceOf(address(bob)), uint256(10), "Other user receives own tokens");
    }

    /// @notice 拒绝零金额、无效 Token；直接转币不得形成用户存款。
    function invalidInputsAndDirectTransfer() public {
        _expectRevert(address(bank), abi.encodeCall(bank.deposit, (0)), "Amount must be positive");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (0)), "Amount must be positive");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (1)), "Insufficient deposited balance");
        try new TokenBank(address(0)) {
            Assert.ok(false, "Zero token address must fail");
        } catch Error(string memory reason) {
            Assert.equal(reason, "Invalid token", "Invalid token error");
        }
        // 直接转 Token 不会调用 deposit，因此不计入个人存款。
        token.transfer(address(bank), 5);
        Assert.equal(bank.balances(address(this)), uint256(0), "Direct transfer does not create deposit credit");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (5)), "Insufficient deposited balance");
        Assert.equal(token.balanceOf(address(bank)), uint256(5), "Uncredited tokens cannot be withdrawn");
    }

    /// @notice Token 返回 false 时存取款回滚，恢复后同一操作可重试。
    function failedTransfersRollBackAndCanRetry() public {
        SwitchableToken failingToken = new SwitchableToken();
        TokenBank failingBank = new TokenBank(address(failingToken));
        _expectRevert(address(failingBank), abi.encodeCall(failingBank.deposit, (5)), "Token transfer failed");
        Assert.equal(failingBank.balances(address(this)), uint256(0), "False deposit does not credit user");
        failingToken.setSucceeds(true);
        failingBank.deposit(5);
        failingToken.setSucceeds(false);
        _expectRevert(address(failingBank), abi.encodeCall(failingBank.withdraw, (5)), "Token transfer failed");
        Assert.equal(failingBank.balances(address(this)), uint256(5), "False withdrawal rolls back debit");
        failingToken.setSucceeds(true);
        failingBank.withdraw(5);
        Assert.equal(failingBank.balances(address(this)), uint256(0), "Withdrawal can be retried");
    }

    /// @notice 验证自动入口受限、半额按用户比例扣账且银行账面仍与实际资产一致。
    function automatedHalfWithdrawalPreservesClaims() public {
        token.transfer(address(bob), 40);
        token.approve(address(bank), 60);
        bank.deposit(60);
        bob.approve(token, bank, 40);
        bob.deposit(bank, 40);

        _expectRevert(address(bob), abi.encodeCall(bob.withdrawhalf, (bank, address(0xBEEF))), "Not authorized");
        bank.setAutomationReceiver(address(bob));
        bob.withdrawhalf(bank, address(0xBEEF));

        Assert.equal(bank.totalDeposits(), uint256(50), "Half sweep updates total deposits");
        Assert.equal(bank.balances(address(this)), uint256(30), "First user keeps half claim");
        Assert.equal(bank.balances(address(bob)), uint256(20), "Second user keeps half claim");
        Assert.equal(token.balanceOf(address(bank)), uint256(50), "Bank assets match claims");
        Assert.equal(token.balanceOf(address(0xBEEF)), uint256(50), "Recipient receives half");
    }

    /// @notice 同时核对调用失败和具体原因，避免其他错误被当作通过。
    function _expectRevert(address target, bytes memory data, string memory message) private {
        (bool ok, bytes memory reason) = target.call(data);
        Assert.ok(!ok, "Call must revert");
        Assert.equal(keccak256(reason), keccak256(abi.encodeWithSignature("Error(string)", message)), "Expected error");
    }
}
