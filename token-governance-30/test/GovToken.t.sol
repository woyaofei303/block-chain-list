// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {GovToken} from "../src/GovToken.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/IERC6093.sol";

contract GovTokenTest is Test {
    /// @notice 发行量固定，持币不会自动获得票权；自我委托才激活相同数量的票。
    function testFixedSupplyAndSelfDelegation() public {
        GovToken token = new GovToken(address(this));
        assertEq(token.totalSupply(), 1_000_000 ether);
        assertEq(token.balanceOf(address(this)), 1_000_000 ether);
        assertEq(token.getVotes(address(this)), 0);
        token.delegate(address(this));
        assertEq(token.getVotes(address(this)), 1_000_000 ether);
    }

    /// @notice 发行目标不能是零地址，避免初始供应量无可用持有人。
    function testRejectZeroInitialHolder() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        new GovToken(address(0));
    }

    /// @notice 任意合法转账会移动当前票权，但不会改写前一块的余额对应票权和总供应量。
    function testFuzzTransferPreservesPastVotes(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000 ether);
        GovToken token = new GovToken(address(this));
        address bob = makeAddr("bob");
        token.delegate(address(this));
        vm.prank(bob);
        token.delegate(bob);
        uint256 snapshot = block.number;
        vm.roll(snapshot + 1);
        token.transfer(bob, amount);
        assertEq(token.getVotes(address(this)), 1_000_000 ether - amount);
        assertEq(token.getVotes(bob), amount);
        assertEq(token.getPastVotes(address(this), snapshot), 1_000_000 ether);
        assertEq(token.getPastVotes(bob, snapshot), 0);
        assertEq(token.getPastTotalSupply(snapshot), 1_000_000 ether);
        assertEq(token.totalSupply(), 1_000_000 ether);
    }
}
