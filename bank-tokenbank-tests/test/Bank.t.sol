// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

interface BankVm {
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
}

contract BankTest {
    BankVm private constant vm = BankVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Bank private bank;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CAROL = address(0xCA401);
    address private constant DAVE = address(0xDA7E);

    function setUp() public {
        bank = new Bank();
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
        vm.deal(CAROL, 10 ether);
        vm.deal(DAVE, 10 ether);
    }

    function testDepositUpdatesUserBalance() public {
        uint256 beforeDeposit = bank.deposits(ALICE);

        vm.prank(ALICE);
        bank.deposit{value: 2 ether}();

        require(beforeDeposit == 0, "initial deposit should be zero");
        require(bank.deposits(ALICE) == beforeDeposit + 2 ether, "deposit was not recorded");
    }

    function testTop3WithOneUser() public {
        _deposit(ALICE, 1 ether);
        _assertTop3(ALICE, address(0), address(0));
    }

    function testTop3WithTwoUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 2 ether);
        _assertTop3(BOB, ALICE, address(0));
    }

    function testTop3WithThreeUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 3 ether);
        _deposit(CAROL, 2 ether);
        _assertTop3(BOB, CAROL, ALICE);
    }

    function testTop3WithFourUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 4 ether);
        _deposit(CAROL, 2 ether);
        _deposit(DAVE, 3 ether);
        _assertTop3(BOB, DAVE, CAROL);
    }

    function testTop3UsesSameUsersCumulativeDeposits() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 4 ether);
        _deposit(CAROL, 3 ether);
        _deposit(DAVE, 2 ether);
        _deposit(ALICE, 4 ether);

        require(bank.deposits(ALICE) == 5 ether, "repeated deposits should accumulate");
        _assertTop3(ALICE, BOB, CAROL);
    }

    function testOnlyAdminCanWithdraw() public {
        _deposit(ALICE, 3 ether);

        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Only admin"));
        vm.prank(BOB);
        bank.withdraw();
        require(address(bank).balance == 3 ether, "non-admin changed the bank balance");

        uint256 adminBalanceBefore = address(this).balance;
        bank.withdraw();
        require(address(bank).balance == 0, "admin did not empty the bank");
        require(address(this).balance == adminBalanceBefore + 3 ether, "admin did not receive the funds");
    }

    receive() external payable {}

    function _deposit(address user, uint256 amount) private {
        vm.prank(user);
        bank.deposit{value: amount}();
    }

    function _assertTop3(address first, address second, address third) private view {
        require(bank.top3(0) == first, "wrong first place");
        require(bank.top3(1) == second, "wrong second place");
        require(bank.top3(2) == third, "wrong third place");
    }
}
