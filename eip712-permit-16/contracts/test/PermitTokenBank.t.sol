// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {JulianToken} from "../src/JulianToken.sol";
import {IdempotentTokenBank as TokenBank} from "../src/IdempotentTokenBank.sol";

contract PermitTokenBankTest is Test {
    JulianToken token;
    TokenBank bank;
    address user;
    uint256 userKey;

    function setUp() public {
        (user, userKey) = makeAddrAndKey("depositor");
        token = new JulianToken();
        bank = new TokenBank(address(token), address(0));
        token.transfer(user, 1_000 ether);
    }

    function signPermit(uint256 amount, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                hex"1901",
                token.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        user,
                        address(bank),
                        amount,
                        token.nonces(user),
                        deadline
                    )
                )
            )
        );
        return vm.sign(userKey, hash);
    }

    function testPermitDepositTransfersTokensWithoutApprove() public {
        uint256 amount = 100 ether;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(amount, deadline);
        assertEq(token.allowance(user, address(bank)), 0);
        console2.log("Before: depositor JUL", token.balanceOf(user));
        console2.log("Before: bank JUL", token.balanceOf(address(bank)));
        vm.prank(user);
        bank.permitDeposit(amount, bytes32(uint256(1)), deadline, v, r, s);
        assertEq(token.balanceOf(user), 900 ether);
        assertEq(token.balanceOf(address(bank)), amount);
        assertEq(bank.balances(user), amount);
        assertEq(token.nonces(user), 1);
        assertEq(token.allowance(user, address(bank)), 0);
        console2.log("After: depositor JUL", token.balanceOf(user));
        console2.log("After: bank JUL", token.balanceOf(address(bank)));
        console2.log("After: withdrawable JUL", bank.balances(user));
    }

    function testPermitCanBeSubmittedBeforeDeposit() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(100 ether, deadline);
        token.permit(user, address(bank), 100 ether, deadline, v, r, s);
        vm.prank(user);
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, s);
        assertEq(bank.balances(user), 100 ether);
        assertEq(token.nonces(user), 1);
    }

    function testReplayAndForgedCallerCannotSpend() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(100 ether, deadline);
        vm.expectRevert();
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, s);
        assertEq(token.nonces(user), 0);
        vm.startPrank(user);
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, s);
        vm.expectRevert();
        bank.permitDeposit(100 ether, bytes32(uint256(2)), deadline, v, r, s);
        vm.stopPrank();
        assertEq(bank.balances(user), 100 ether);
        assertEq(token.balanceOf(user), 900 ether);
    }

    function testExpiredTamperedAndWrongChainPermitRejectWithoutChanges() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(100 ether, deadline);
        vm.startPrank(user);
        vm.expectRevert();
        bank.permitDeposit(101 ether, bytes32(uint256(1)), deadline, v, r, s);
        vm.chainId(block.chainid + 1);
        vm.expectRevert();
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, s);
        vm.warp(deadline + 1);
        vm.expectRevert("Permit expired");
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, s);
        vm.stopPrank();
        assertEq(token.nonces(user), 0);
        assertEq(bank.balances(user), 0);
        assertEq(token.balanceOf(user), 1_000 ether);
    }

    function testInsufficientFundsRollsBackPermit() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(1_001 ether, deadline);
        vm.prank(user);
        vm.expectRevert();
        bank.permitDeposit(1_001 ether, bytes32(uint256(1)), deadline, v, r, s);
        assertEq(token.nonces(user), 0);
        assertEq(token.allowance(user, address(bank)), 0);
        assertEq(bank.balances(user), 0);
    }

    function testOrdinaryDepositWithdrawAndDirectTransfer() public {
        vm.startPrank(user);
        token.transfer(address(bank), 10 ether);
        assertEq(bank.balances(user), 0);
        token.approve(address(bank), 100 ether);
        bank.deposit(100 ether, bytes32(uint256(1)));
        bank.withdraw(40 ether, bytes32(uint256(2)));
        vm.expectRevert("Insufficient deposited balance");
        bank.withdraw(61 ether, bytes32(uint256(3)));
        vm.expectRevert("Invalid operation");
        bank.deposit(0, bytes32(uint256(1)));
        vm.expectRevert("Invalid operation");
        bank.withdraw(0, bytes32(uint256(2)));
        vm.stopPrank();
        vm.expectRevert("Insufficient deposited balance");
        bank.withdraw(1, bytes32(uint256(2)));
        assertEq(bank.balances(user), 60 ether);
        assertEq(token.balanceOf(address(bank)), 70 ether);
        assertEq(token.balanceOf(user), 930 ether);
    }

    function testFuzzPermitDepositAndWithdraw(uint256 amount) public {
        amount = bound(amount, 1, 1_000 ether);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = signPermit(amount, deadline);
        vm.startPrank(user);
        bank.permitDeposit(amount, bytes32(uint256(1)), deadline, v, r, s);
        bank.withdraw(amount, bytes32(uint256(2)));
        vm.stopPrank();
        assertEq(token.balanceOf(user), 1_000 ether);
        assertEq(bank.balances(user), 0);
        assertEq(token.balanceOf(address(bank)), 0);
    }

    function testPermitAndOrdinaryDepositShareIdempotency() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 sigS) = signPermit(100 ether, deadline);
        vm.startPrank(user);
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, sigS);
        bank.deposit(100 ether, bytes32(uint256(1)));
        vm.warp(deadline + 1);
        bank.permitDeposit(100 ether, bytes32(uint256(1)), deadline, v, r, sigS);
        vm.expectRevert("Operation conflict");
        bank.permitDeposit(101 ether, bytes32(uint256(1)), deadline, v, r, sigS);
        vm.stopPrank();
        assertEq(token.nonces(user), 1);
        assertEq(bank.balances(user), 100 ether);
    }
}
