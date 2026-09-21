// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseERC20} from "../src/BaseERC20.sol";
import {IdempotentTokenBank} from "../src/IdempotentTokenBank.sol";

contract IdempotentTokenBankTest {
    function testReplayConflictAndRollback() public {
        BaseERC20 token = new BaseERC20();
        IdempotentTokenBank bank = new IdempotentTokenBank(address(token));
        bytes32 depositId = keccak256("deposit");
        token.approve(address(bank), 10 ether);
        bank.deposit(10 ether, depositId);
        bank.deposit(10 ether, depositId);
        require(bank.balances(address(this)) == 10 ether, "replay moved money");
        require(token.balanceOf(address(bank)) == 10 ether, "duplicate deposit");
        (bool changed,) = address(bank).call(abi.encodeCall(bank.deposit, (1 ether, depositId)));
        require(!changed, "accepted different payload");
        (bool wrongAction,) = address(bank).call(abi.encodeCall(bank.withdraw, (10 ether, depositId)));
        require(!wrongAction, "accepted different action");
        bytes32 withdrawId = keccak256("withdraw");
        bank.withdraw(4 ether, withdrawId);
        bank.withdraw(4 ether, withdrawId);
        require(bank.balances(address(this)) == 6 ether, "duplicate withdrawal");
        bytes32 failedId = keccak256("retry");
        (bool failed,) = address(bank).call(abi.encodeCall(bank.deposit, (1 ether, failedId)));
        require(!failed && bank.operationHash(address(this), failedId) == bytes32(0), "failed operation consumed id");
        token.approve(address(bank), 1 ether);
        bank.deposit(1 ether, failedId);
        require(bank.balances(address(this)) == 7 ether, "retry did not work");
        (bool legacy,) = address(bank).call(abi.encodeWithSignature("deposit(uint256)", 1 ether));
        require(!legacy, "unprotected legacy entry");
    }
}

contract CallbackToken {
    IdempotentTokenBank public bank;
    bool public blocked;
    bool public failTransfer;

    function configure(IdempotentTokenBank value) external {
        bank = value;
    }

    function fail() external {
        failTransfer = true;
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        (bool ok,) = address(bank).call(abi.encodeCall(bank.deposit, (1, keccak256("nested"))));
        blocked = !ok;
        return true;
    }

    function transfer(address, uint256) external view returns (bool) {
        return !failTransfer;
    }
}

contract IdempotentTokenBankSafetyTest {
    function testReentrancyAndFailedWithdrawalRollback() public {
        CallbackToken token = new CallbackToken();
        IdempotentTokenBank bank = new IdempotentTokenBank(address(token));
        token.configure(bank);
        bank.deposit(10, keccak256("deposit"));
        require(token.blocked(), "reentrancy accepted");
        require(bank.operationHash(address(token), keccak256("nested")) == bytes32(0), "nested operation recorded");
        token.fail();
        bytes32 id = keccak256("withdraw");
        (bool ok,) = address(bank).call(abi.encodeCall(bank.withdraw, (5, id)));
        require(!ok, "accepted failed transfer");
        require(
            bank.balances(address(this)) == 10 && bank.operationHash(address(this), id) == bytes32(0),
            "rollback incomplete"
        );
    }
}
