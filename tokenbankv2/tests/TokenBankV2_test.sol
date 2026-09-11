// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// 断言库由 Remix Solidity Unit Testing 插件提供，无需 Foundry 或 npm。
import "remix_tests.sol";
import "../contracts/ERC20WithCallback.sol";
import "../contracts/TokenBankV2.sol";
import "./HookHelpers.sol";

contract TokenBankV2Test {
    ERC20WithCallback private token;
    TokenBankV2 private bank;

    // 每组独立部署；测试合约是 Token 部署者，也就是第一位存款人。
    function beforeEach() public {
        token = new ERC20WithCallback();
        bank = new TokenBankV2(address(token));
    }

    function callbackDepositAndWithdraw() public {
        // ether 这里只是 Solidity 的 10 ** 18 数量后缀，没有发送 ETH。
        uint256 supply = token.totalSupply();
        Assert.ok(token.transferWithCallback(address(bank), 10 ether), "Hook transfer succeeds");
        Assert.equal(bank.balances(address(this)), 10 ether, "Hook credits sender");
        Assert.equal(token.balanceOf(address(bank)), 10 ether, "Bank receives tokens");
        Assert.equal(token.balanceOf(address(this)), supply - 10 ether, "Sender pays once");
        Assert.equal(bank.balances(address(token)), uint256(0), "Do not credit Token contract");
        Assert.equal(token.allowance(address(this), address(bank)), uint256(0), "No approval needed");
        bank.withdraw(4 ether);
        Assert.equal(bank.balances(address(this)), 6 ether, "Partial withdrawal debits credit");
        bank.withdraw(6 ether);
        Assert.equal(bank.balances(address(this)), uint256(0), "Full withdrawal clears credit");
        Assert.equal(token.balanceOf(address(this)), supply, "Tokens return to sender");
        Assert.equal(token.balanceOf(address(bank)), uint256(0), "Bank is empty");
    }

    function eoaAndContractReceiver() public {
        address eoa = address(0xB0B);
        Assert.equal(eoa.code.length, uint256(0), "Recipient has no code");
        Assert.ok(token.transferWithCallback(eoa, 2 ether), "No hook needed without code");
        Assert.ok(token.transferWithCallback(eoa, 0), "Zero transfer to EOA is allowed");
        Assert.equal(token.balanceOf(eoa), 2 ether, "EOA receives tokens");

        HookReceiver receiver = new HookReceiver(token, 0);
        token.transferWithCallback(address(receiver), 5 ether);
        Assert.equal(receiver.caller(), address(token), "Token calls the receiver");
        Assert.equal(receiver.from(), address(this), "Original sender is forwarded");
        Assert.equal(receiver.amount(), 5 ether, "Amount is forwarded");
        Assert.equal(receiver.receivedBalance(), 5 ether, "Transfer happens before callback");
        Assert.equal(receiver.calls(), uint256(1), "Exactly one callback");
    }

    function legacyDepositAndUserIsolation() public {
        HookBankUser bob = new HookBankUser();
        token.transfer(address(bob), 7 ether);
        _expectRevert(address(bank), abi.encodeCall(bank.deposit, (1 ether)), "ERC20: transfer amount exceeds allowance");
        token.approve(address(bank), 7 ether);
        bank.deposit(3 ether);
        Assert.equal(bank.balances(address(this)), 3 ether, "Legacy deposit credits once");
        token.transferWithCallback(address(bank), 2 ether);
        Assert.equal(token.allowance(address(this), address(bank)), 4 ether, "Hook does not consume approval");
        Assert.equal(bank.balances(address(this)), 5 ether, "Both deposit routes share one ledger");
        _expectRevert(address(bob), abi.encodeCall(bob.withdraw, (bank, 1 ether)), "Insufficient deposited balance");

        bob.deposit(token, bank, 7 ether);
        Assert.equal(bank.balances(address(bob)), 7 ether, "Contract user owns its deposit");
        Assert.equal(bank.balances(address(this)), 5 ether, "Other user unchanged");
        Assert.equal(token.balanceOf(address(bank)), 12 ether, "Assets cover both users");
        bank.withdraw(5 ether);
        Assert.equal(bank.balances(address(bob)), 7 ether, "Withdrawals are isolated");
        bob.withdraw(bank, 7 ether);
        Assert.equal(token.balanceOf(address(bob)), 7 ether, "Contract user receives its tokens");
        Assert.equal(token.balanceOf(address(bank)), uint256(0), "All deposits returned");
    }

    function forgedCallbacksAndInvalidAmounts() public {
        token.transferWithCallback(address(bank), 5 ether);
        _expectRevert(address(bank), abi.encodeCall(bank.tokensReceived, (address(this), 100 ether)), "Only supported token");
        ERC20WithCallback otherToken = new ERC20WithCallback();
        _expectRevert(address(otherToken), abi.encodeCall(otherToken.transferWithCallback, (address(bank), 2 ether)), "Only supported token");
        Assert.equal(otherToken.balanceOf(address(this)), otherToken.totalSupply(), "Wrong token transfer rolls back");
        Assert.equal(otherToken.balanceOf(address(bank)), uint256(0), "Bank receives no wrong token");
        _expectRevert(address(token), abi.encodeCall(token.transferWithCallback, (address(bank), 0)), "Amount must be positive");
        _expectRevert(address(bank), abi.encodeCall(bank.deposit, (0)), "Amount must be positive");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (0)), "Amount must be positive");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (6 ether)), "Insufficient deposited balance");
        Assert.equal(bank.balances(address(this)), 5 ether, "Invalid calls cannot change credit");
        Assert.equal(token.balanceOf(address(bank)), 5 ether, "Real deposits remain backed");
    }

    function rejectedCallbacksRollBack() public {
        uint256 supply = token.totalSupply();
        HookReceiver rejecting = new HookReceiver(token, 1);
        _expectRevert(address(token), abi.encodeCall(token.transferWithCallback, (address(rejecting), 3 ether)), "ERC20: callback rejected");
        HookReceiver reverting = new HookReceiver(token, 2);
        _expectRevert(address(token), abi.encodeCall(token.transferWithCallback, (address(reverting), 3 ether)), "Receiver reverted");
        // 原版银行未实现接收接口，因此 Hook 转账必须失败，不能留下无账可取的币。
        TokenBank oldBank = new TokenBank(address(token));
        (bool ok,) = address(token).call(abi.encodeCall(token.transferWithCallback, (address(oldBank), 3 ether)));
        Assert.ok(!ok, "Missing callback must revert");
        Assert.equal(token.balanceOf(address(this)), supply, "All failed transfers refund sender");
        Assert.equal(token.balanceOf(address(rejecting)), uint256(0), "False receiver gets no tokens");
        Assert.equal(token.balanceOf(address(reverting)), uint256(0), "Reverting receiver gets no tokens");
        Assert.equal(token.balanceOf(address(oldBank)), uint256(0), "Old bank gets no tokens");
        Assert.equal(rejecting.calls(), uint256(0), "False receiver state also rolls back");
        Assert.equal(reverting.calls(), uint256(0), "Reverting receiver state also rolls back");
    }

    function plainTransferAndAddressChecks() public {
        _expectRevert(address(token), abi.encodeCall(token.transferWithCallback, (address(0), 1)), "ERC20: transfer to the zero address");
        _expectRevert(address(token), abi.encodeCall(token.transferWithCallback, (address(bank), token.totalSupply() + 1)), "ERC20: transfer amount exceeds balance");
        try new TokenBankV2(address(0)) {
            Assert.ok(false, "Zero token must fail");
        } catch Error(string memory reason) {
            Assert.equal(reason, "Invalid token", "Invalid token error");
        }
        // ERC20 的普通 transfer 仍然不触发回调；这笔 1 Token 不会变成个人存款。
        token.transfer(address(bank), 1 ether);
        Assert.equal(bank.balances(address(this)), uint256(0), "Plain transfer is not a deposit");
        _expectRevert(address(bank), abi.encodeCall(bank.withdraw, (1 ether)), "Insufficient deposited balance");
        Assert.equal(token.balanceOf(address(bank)), 1 ether, "Uncredited token remains in bank");
    }

    // 通过外部调用验证真实回滚原因；不能只看失败，否则其他错误也可能误判为通过。
    function _expectRevert(address target, bytes memory data, string memory message) private {
        (bool ok, bytes memory reason) = target.call(data);
        Assert.ok(!ok, "Call must revert");
        Assert.equal(keccak256(reason), keccak256(abi.encodeWithSignature("Error(string)", message)), "Expected error");
    }
}
