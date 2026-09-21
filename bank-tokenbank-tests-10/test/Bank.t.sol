// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

// 本项目不依赖 forge-std，只声明测试实际使用的三个 Foundry cheatcode。
interface BankVm {
    // 给测试地址设置 ETH 余额。
    function deal(address account, uint256 newBalance) external;
    // 声明下一次普通外部调用必须按指定错误回滚。
    function expectRevert(bytes calldata revertData) external;
    // 仅让下一次普通外部调用的 msg.sender 变为指定地址。
    function prank(address msgSender) external;
}

contract BankTest {
    // Foundry 把 cheatcode 暴露在由 "hevm cheat code" 计算出的固定地址上。
    BankVm private constant vm = BankVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Bank private bank;

    // 四个固定地址代表四位互不相同的存款人，便于阅读断言中的预期顺序。
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CAROL = address(0xCA401);
    address private constant DAVE = address(0xDA7E);

    // Foundry 会在每个 test* 函数前重新执行 setUp。
    // 因此每个测试都有全新的 Bank 和四个余额充足的用户，不会互相污染状态。
    function setUp() public {
        bank = new Bank();
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
        vm.deal(CAROL, 10 ether);
        vm.deal(DAVE, 10 ether);
    }

    // Case 1：读取存款前余额，Alice 存入 2 ETH，再检查新值等于旧值加本次金额。
    function testDepositUpdatesUserBalance() public {
        uint256 beforeDeposit = bank.deposits(ALICE);

        // 只有紧接着的 deposit 调用会以 Alice 身份执行。
        vm.prank(ALICE);
        bank.deposit{value: 2 ether}();

        require(beforeDeposit == 0, "initial deposit should be zero");
        require(bank.deposits(ALICE) == beforeDeposit + 2 ether, "deposit was not recorded");
    }

    // Case 2.1：只有一位用户时，Alice 第一，其余两个位置为空地址。
    function testTop3WithOneUser() public {
        _deposit(ALICE, 1 ether);
        _assertTop3(ALICE, address(0), address(0));
    }

    // Case 2.2：两位用户按累计金额降序排列，2 ETH 的 Bob 在前。
    function testTop3WithTwoUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 2 ether);
        _assertTop3(BOB, ALICE, address(0));
    }

    // Case 2.3：三位用户填满排行榜，预期顺序为 3、2、1 ETH。
    function testTop3WithThreeUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 3 ether);
        _deposit(CAROL, 2 ether);
        _assertTop3(BOB, CAROL, ALICE);
    }

    // Case 2.4：第四位用户 Dave 存入 3 ETH 后挤掉最低的 Alice。
    function testTop3WithFourUsers() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 4 ether);
        _deposit(CAROL, 2 ether);
        _deposit(DAVE, 3 ether);
        _assertTop3(BOB, DAVE, CAROL);
    }

    // Case 2.5：Alice 先存 1 ETH，稍后再存 4 ETH。
    // 排名使用累计 5 ETH，并且 Alice 只在 top3 中出现一次。
    function testTop3UsesSameUsersCumulativeDeposits() public {
        _deposit(ALICE, 1 ether);
        _deposit(BOB, 4 ether);
        _deposit(CAROL, 3 ether);
        _deposit(DAVE, 2 ether);
        _deposit(ALICE, 4 ether);

        require(bank.deposits(ALICE) == 5 ether, "repeated deposits should accumulate");
        _assertTop3(ALICE, BOB, CAROL);
    }

    // Case 3：先让非管理员 Bob 提款并验证回滚，再由管理员成功提走全部 ETH。
    function testOnlyAdminCanWithdraw() public {
        _deposit(ALICE, 3 ether);

        // BankTest 部署了 Bank，所以管理员是 address(this)，Bob 必须被拒绝。
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Only admin"));
        vm.prank(BOB);
        bank.withdraw();
        require(address(bank).balance == 3 ether, "non-admin changed the bank balance");

        // 不使用 prank 时调用者恢复为 BankTest，也就是管理员。
        uint256 adminBalanceBefore = address(this).balance;
        bank.withdraw();
        require(address(bank).balance == 0, "admin did not empty the bank");
        require(address(this).balance == adminBalanceBefore + 3 ether, "admin did not receive the funds");
    }

    // Bank 提款时会向管理员 BankTest 转 ETH，因此测试合约需要能够接收 ETH。
    receive() external payable {}

    // 统一完成“切换用户 + 附带 ETH 调用 deposit”，让各排名 Case 只保留业务步骤。
    function _deposit(address user, uint256 amount) private {
        vm.prank(user);
        bank.deposit{value: amount}();
    }

    // 同时检查三个固定榜位，失败信息可以直接指出错误位置。
    function _assertTop3(address first, address second, address third) private view {
        require(bank.top3(0) == first, "wrong first place");
        require(bank.top3(1) == second, "wrong second place");
        require(bank.top3(2) == third, "wrong third place");
    }
}
