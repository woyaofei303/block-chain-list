// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeploySepolia} from "../script/DeploySepolia.s.sol";
import {JulianToken} from "../src/JulianToken.sol";
import {IdempotentTokenBank} from "../src/IdempotentTokenBank.sol";

contract DeploySepoliaTest is Test {
    function testDeploymentGuardsAndConfiguration() public {
        DeploySepolia script = new DeploySepolia();
        address deployer = makeAddr("deployer");
        uint64 nonce = vm.getNonce(deployer);

        vm.chainId(31337);
        vm.expectRevert("Sepolia only");
        script.run(deployer);

        vm.chainId(11155111);
        vm.expectRevert("Invalid deployer");
        script.run(address(0));
        vm.expectRevert("Permit2 not deployed");
        script.run(deployer);
        vm.etch(script.PERMIT2(), hex"00");
        vm.expectRevert("Delegator not deployed");
        script.run(deployer);
        assertEq(vm.getNonce(deployer), nonce, "guards must run before deployment");

        vm.etch(script.DELEGATOR(), hex"00");
        (JulianToken token, IdempotentTokenBank bank) = script.run(deployer);
        assertEq(vm.getNonce(deployer), nonce + 2);
        assertEq(token.totalSupply(), 1_000_000 ether);
        assertEq(token.balanceOf(deployer), token.totalSupply());
        assertEq(address(bank.token()), address(token));
        assertEq(address(bank.permit2()), script.PERMIT2());
        assertTrue(bank.supportsPermit());
        assertEq(token.balanceOf(address(bank)), 0);
    }
}
