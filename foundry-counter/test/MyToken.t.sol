// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "openzeppelin-contracts/contracts/interfaces/IERC6093.sol";
import {MyToken} from "../src/MyToken.sol";

contract MyTokenTest is Test {
    function test_InitialSupplyBelongsToDeployer() public {
        MyToken token = new MyToken("My Token", "MTK");

        assertEq(token.name(), "My Token");
        assertEq(token.symbol(), "MTK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 10_000_000_000 * 1e18);
        assertEq(token.balanceOf(address(this)), token.totalSupply());
    }

    function testFuzz_TransferAndTransferFromPreserveSupply(uint256 amount) public {
        MyToken token = new MyToken("My Token", "MTK");
        uint256 supply = token.totalSupply();
        amount = bound(amount, 0, supply);
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");

        assertTrue(token.transfer(alice, amount));
        assertEq(token.balanceOf(address(this)), supply - amount);
        assertEq(token.balanceOf(alice), amount);

        vm.prank(alice);
        assertTrue(token.approve(bob, amount));
        assertEq(token.allowance(alice, bob), amount);

        vm.prank(bob);
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        assertTrue(token.transferFrom(alice, bob, amount));
        assertEq(token.allowance(alice, bob), 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), amount);
        assertEq(token.totalSupply(), supply);
    }

    function test_InvalidTransfersRevertWithoutChangingBalances() public {
        MyToken token = new MyToken("My Token", "MTK");
        uint256 supply = token.totalSupply();
        address alice = makeAddr("alice");

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        token.transfer(address(0), 1);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 1));
        vm.prank(alice);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        token.transfer(address(this), 1);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, alice, 0, 1));
        vm.prank(alice);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        token.transferFrom(address(this), alice, 1);

        assertEq(token.balanceOf(address(this)), supply);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), supply);
    }
}
