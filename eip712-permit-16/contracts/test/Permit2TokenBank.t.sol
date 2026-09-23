// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {BaseERC20} from "../src/BaseERC20.sol";
import {IdempotentTokenBank} from "../src/IdempotentTokenBank.sol";
import {ISignatureTransfer} from "../lib/permit2/src/interfaces/ISignatureTransfer.sol";

contract Permit2TokenBankTest is Test {
    BaseERC20 token;
    IdempotentTokenBank bank;
    ISignatureTransfer permit2;
    address user;
    uint256 userKey;

    function setUp() public {
        (user, userKey) = makeAddrAndKey("permit2-depositor");
        permit2 = ISignatureTransfer(deployCode("lib/permit2/out/Permit2.sol/Permit2.json"));
        token = new BaseERC20();
        bank = new IdempotentTokenBank(address(token), address(permit2));
        token.transfer(user, 1_000 ether);
    }

    function signPermit(uint256 amount, bytes32 id, uint256 deadline, address spender)
        internal
        view
        returns (bytes memory)
    {
        bytes32 permissions = keccak256(
            abi.encode(keccak256("TokenPermissions(address token,uint256 amount)"), address(token), amount)
        );
        bytes32 data = keccak256(
            abi.encode(
                keccak256(
                    "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
                ),
                permissions,
                spender,
                uint256(id),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(userKey, keccak256(abi.encodePacked(hex"1901", permit2.DOMAIN_SEPARATOR(), data)));
        return abi.encodePacked(r, s, v);
    }

    function testPermit2DepositTransfersOrdinaryERC20() public {
        uint256 amount = 100 ether;
        bytes32 id = bytes32(uint256(1));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signPermit(amount, id, deadline, address(bank));
        console2.log("Before: wallet BERC20", token.balanceOf(user));
        console2.log("Before: bank BERC20", token.balanceOf(address(bank)));
        vm.startPrank(user);
        token.approve(address(permit2), amount);
        bank.depositWithPermit2(amount, id, deadline, signature);
        vm.stopPrank();
        assertEq(token.balanceOf(user), 900 ether);
        assertEq(token.balanceOf(address(bank)), amount);
        assertEq(bank.balances(user), amount);
        assertEq(token.allowance(user, address(bank)), 0);
        assertEq(permit2.nonceBitmap(user, 0), 2);
        console2.log("After: wallet BERC20", token.balanceOf(user));
        console2.log("After: bank / withdrawable BERC20", bank.balances(user));
    }

    function testReplaySharesLedgerAndCannotChangeAmount() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 id = bytes32(uint256(1));
        bytes memory sig = signPermit(100 ether, id, deadline, address(bank));
        vm.startPrank(user);
        token.approve(address(permit2), 100 ether);
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        vm.warp(deadline + 1);
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        bank.deposit(100 ether, id);
        vm.expectRevert("Operation conflict");
        bank.depositWithPermit2(101 ether, id, deadline, sig);
        bank.withdraw(40 ether, bytes32(uint256(2)));
        vm.stopPrank();
        assertEq(bank.balances(user), 60 ether);
        assertEq(token.balanceOf(user), 940 ether);
        assertEq(token.balanceOf(address(bank)), 60 ether);
        assertEq(permit2.nonceBitmap(user, 0), 2);
    }

    function testSignatureBindsCallerAmountOperationBankAndChain() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 id = bytes32(uint256(1));
        bytes memory sig = signPermit(100 ether, id, deadline, address(bank));
        vm.prank(user);
        token.approve(address(permit2), 100 ether);
        vm.expectRevert();
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        IdempotentTokenBank other = new IdempotentTokenBank(address(token), address(permit2));
        vm.startPrank(user);
        vm.expectRevert();
        bank.depositWithPermit2(101 ether, id, deadline, sig);
        vm.expectRevert();
        bank.depositWithPermit2(100 ether, bytes32(uint256(2)), deadline, sig);
        vm.expectRevert();
        other.depositWithPermit2(100 ether, id, deadline, sig);
        uint256 originalChain = block.chainid;
        vm.chainId(originalChain + 1);
        vm.expectRevert();
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        vm.chainId(originalChain);
        vm.warp(deadline + 1);
        vm.expectRevert();
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        vm.stopPrank();
        assertUnchanged(id);
    }

    function testMissingAllowanceAndInsufficientBalanceRollBackNonceAndOperation() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 id = bytes32(uint256(257));
        bytes memory sig = signPermit(100 ether, id, deadline, address(bank));
        vm.startPrank(user);
        vm.expectRevert();
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        vm.stopPrank();
        assertUnchanged(id);
        sig = signPermit(1_001 ether, id, deadline, address(bank));
        vm.startPrank(user);
        token.approve(address(permit2), 1_001 ether);
        vm.expectRevert();
        bank.depositWithPermit2(1_001 ether, id, deadline, sig);
        vm.stopPrank();
        assertUnchanged(id);
        sig = signPermit(100 ether, id, deadline, address(bank));
        vm.prank(user);
        bank.depositWithPermit2(100 ether, id, deadline, sig);
        assertEq(permit2.nonceBitmap(user, 1), 2);
        assertEq(bank.balances(user), 100 ether);
    }

    function testInvalidConfigurationAndDisabledPermit2() public {
        vm.expectRevert("Invalid Permit2");
        new IdempotentTokenBank(address(token), user);
        IdempotentTokenBank disabled = new IdempotentTokenBank(address(token), address(0));
        vm.prank(user);
        vm.expectRevert("Permit2 unavailable");
        disabled.depositWithPermit2(100 ether, bytes32(uint256(1)), block.timestamp + 1, "");
        assertEq(disabled.operationHash(user, bytes32(uint256(1))), bytes32(0));
    }

    function testFuzzNonceBitmapAndWithdraw(uint256 amount, bytes32 id) public {
        amount = bound(amount, 1, 1_000 ether);
        vm.assume(id != bytes32(0));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = signPermit(amount, id, deadline, address(bank));
        vm.startPrank(user);
        token.approve(address(permit2), amount);
        bank.depositWithPermit2(amount, id, deadline, sig);
        bytes32 withdrawalId = id == bytes32(uint256(1)) ? bytes32(uint256(2)) : bytes32(uint256(1));
        bank.withdraw(amount, withdrawalId);
        vm.stopPrank();
        assertEq(permit2.nonceBitmap(user, uint256(id) >> 8), 1 << (uint256(id) & 255));
        assertEq(bank.balances(user), 0);
        assertEq(token.balanceOf(user), 1_000 ether);
        assertEq(token.balanceOf(address(bank)), 0);
    }

    function assertUnchanged(bytes32 id) internal view {
        assertEq(permit2.nonceBitmap(user, uint256(id) >> 8), 0);
        assertEq(bank.operationHash(user, id), bytes32(0));
        assertEq(bank.balances(user), 0);
        assertEq(token.balanceOf(user), 1_000 ether);
        assertEq(token.balanceOf(address(bank)), 0);
    }
}
