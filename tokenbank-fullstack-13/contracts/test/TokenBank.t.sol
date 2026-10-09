// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseERC20} from "../src/BaseERC20.sol";
import {TokenBank} from "../src/TokenBank.sol";

contract TokenBankTest {
    /// @notice 把实际 Token 余额和银行个人账本分别核对；直接转币只增加银行资产，不增加个人可提额。
    function testDepositWithdrawalAndDirectTransfer() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        uint256 initial = token.balanceOf(address(this));
        uint256 amount = 10 ether + 1;
        token.approve(address(bank), amount);
        bank.deposit(amount);
        require(bank.balances(address(this)) == amount, "deposit accounting");
        require(token.balanceOf(address(bank)) == amount, "actual assets");
        require(token.allowance(address(this), address(bank)) == 0, "exact allowance");
        bank.withdraw(4 ether);
        require(bank.balances(address(this)) == 6 ether + 1, "withdraw accounting");
        (bool success,) = address(bank).call(abi.encodeCall(bank.withdraw, (7 ether)));
        require(!success && bank.balances(address(this)) == 6 ether + 1, "overdraft rollback");
        bank.withdraw(6 ether + 1);
        require(token.balanceOf(address(this)) == initial, "funds returned");
        token.transfer(address(bank), 1 ether);
        require(bank.balances(address(this)) == 0, "direct transfer is not a deposit");
        require(token.balanceOf(address(bank)) == 1 ether, "direct transfer assets");
    }

    /// @notice 未授权的存款应失败，钱包、银行资产和个人账本都保持原状。
    function testUnapprovedDepositRollsBack() public {
        BaseERC20 token = new BaseERC20();
        TokenBank bank = new TokenBank(address(token));
        uint256 initial = token.balanceOf(address(this));
        (bool success,) = address(bank).call(abi.encodeCall(bank.deposit, (1 ether)));
        require(!success, "approval required");
        require(token.balanceOf(address(this)) == initial, "wallet preserved");
        require(token.balanceOf(address(bank)) == 0, "bank assets preserved");
        require(bank.balances(address(this)) == 0, "bank ledger preserved");
    }
}
