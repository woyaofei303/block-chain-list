// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bank} from "../src/Bank.sol";

interface BankVm {
    /// @notice 设置本地测试账户余额，不涉及真实资金。
    function deal(address account, uint256 balance) external;
    /// @notice 仅让下一次普通外部调用使用指定发送者。
    function prank(address sender) external;
    /// @notice 断言下一次外部调用按给定错误回滚。
    function expectRevert(bytes calldata reason) external;
}

contract BankTest {
    BankVm private constant vm = BankVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Bank private bank;
    bool private rejectPayment;
    bool private tryReentry;

    /// @notice 每个用例部署独立 Bank，测试合约是管理员。
    function setUp() public {
        bank = new Bank();
    }

    /// @notice 钱包直接转账与显式存款共同累计，重复存款只占一个链表节点。
    function testBothEntrancesAccumulateAndRemainIterable() public {
        address alice = address(0xA11CE);
        vm.deal(alice, 3 ether);
        vm.prank(alice);
        (bool success,) = address(bank).call{value: 1 ether}("");
        require(success, "direct deposit failed");
        vm.prank(alice);
        bank.deposit{value: 2 ether}();

        require(bank.deposits(alice) == 3 ether, "wrong cumulative deposit");
        require(address(bank).balance == 3 ether, "wrong bank balance");
        require(bank.next(address(0)) == alice, "first depositor missing from list");
        require(bank.next(alice) == address(0), "tail must end at zero");
        require(bank.size() == 1, "duplicate depositor");
    }

    /// @notice 12 位用户乱序存款，只保留最高 10 人且可从哨兵遍历至尾部。
    function testKeepsHighestTenAcrossHeadMiddleAndTailInsertions() public {
        uint256[12] memory order = [uint256(5), 1, 9, 3, 12, 2, 8, 4, 11, 6, 10, 7];
        for (uint256 i; i < order.length; i++) {
            _deposit(address(uint160(order[i])), order[i] * 1 ether);
        }
        address[] memory expected = new address[](10);
        for (uint256 i; i < 10; i++) {
            expected[i] = address(uint160(12 - i));
        }
        _assertRanking(expected);
        require(bank.deposits(address(1)) == 1 ether, "eviction erased history");
        require(bank.next(address(1)) == address(0), "evicted link remains");
        require(bank.next(address(2)) == address(0), "evicted link remains");
    }

    /// @notice 空榜返回空数组，零地址哨兵不占名额。
    function testEmptyList() public view {
        _assertRanking(new address[](0));
        require(bank.admin() == address(this), "wrong admin");
    }

    /// @notice 同额不挤榜；榜外累计超过门槛可入榜，淘汰者再次追加也能回来。
    function testTiesAtCapacityAndEvictedUserCanReenter() public {
        address[] memory expected = new address[](10);
        for (uint256 i; i < 10; i++) {
            expected[i] = address(uint160(i + 1));
            _deposit(expected[i], 10);
        }
        _deposit(address(11), 9);
        _assertRanking(expected);
        _deposit(address(11), 1);
        _assertRanking(expected);

        _deposit(address(11), 1);
        expected[0] = address(11);
        for (uint256 i = 1; i < 10; i++) {
            expected[i] = address(uint160(i));
        }
        _assertRanking(expected);
        require(bank.next(address(10)) == address(0), "evicted node still linked");

        _deposit(address(10), 1);
        expected[1] = address(10);
        for (uint256 i = 2; i < 10; i++) {
            expected[i] = address(uint160(i - 1));
        }
        _assertRanking(expected);
        require(bank.deposits(address(10)) == 11, "reentry lost previous deposits");
    }

    /// @notice 尾节点和中间节点追加存款后向前移动，同额仍在原同额用户之后。
    function testExistingNodesMoveWithoutDuplicatesOrCycles() public {
        address[] memory expected = new address[](4);
        for (uint256 i; i < 4; i++) {
            expected[i] = address(uint160(i + 1));
            _deposit(expected[i], (4 - i) * 10);
        }
        _deposit(address(4), 10);
        _assertRanking(expected);
        _deposit(address(4), 20);
        expected[1] = address(4);
        expected[2] = address(2);
        expected[3] = address(3);
        _assertRanking(expected);
        _deposit(address(1), 1);
        _assertRanking(expected);
        _deposit(address(2), 20);
        expected[0] = address(2);
        expected[1] = address(1);
        expected[2] = address(4);
        _assertRanking(expected);
    }

    /// @notice 两个入口的零金额及带未知 calldata 的转账均拒绝，原有资金与排名不变。
    function testInvalidDepositsPreserveState() public {
        _deposit(address(1), 5);
        bytes memory reason = abi.encodeWithSignature("Error(string)", "Deposit must be positive");
        vm.expectRevert(reason);
        bank.deposit();
        (bool success, bytes memory data) = address(bank).call("");
        require(!success && keccak256(data) == keccak256(reason), "zero direct transfer accepted");
        vm.deal(address(this), 1);
        (success,) = address(bank).call{value: 1}(hex"deadbeef");
        require(!success, "unknown calldata accepted");
        require(address(bank).balance == 5 && bank.deposits(address(this)) == 0, "failed deposit changed balances");
        address[] memory expected = new address[](1);
        expected[0] = address(1);
        _assertRanking(expected);
    }

    /// @notice 非管理员与空余额提款失败；成功提款保留历史，之后可继续存款和提款。
    function testWithdrawalPermissionsAndHistory() public {
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Nothing to withdraw"));
        bank.withdraw();
        _deposit(address(1), 5);
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Only admin"));
        vm.prank(address(1));
        bank.withdraw();
        require(address(bank).balance == 5, "unauthorized withdrawal moved funds");

        uint256 beforeBalance = address(this).balance;
        bank.withdraw();
        require(address(bank).balance == 0 && address(this).balance == beforeBalance + 5, "wrong payout");
        require(bank.deposits(address(1)) == 5, "withdrawal erased history");
        address[] memory expected = new address[](1);
        expected[0] = address(1);
        _assertRanking(expected);
        _deposit(address(1), 2);
        require(bank.deposits(address(1)) == 7, "history did not accumulate");
        _assertRanking(expected);
        bank.withdraw();
        require(address(bank).balance == 0, "second withdrawal failed");
    }

    /// @notice 管理员拒收时回滚；重新允许收款后可重试，收款回调重入被锁阻止。
    function testRejectedWithdrawalRollsBackAndReentryIsBlocked() public {
        _deposit(address(1), 5);
        rejectPayment = true;
        vm.expectRevert(abi.encodeWithSignature("Error(string)", "Withdrawal failed"));
        bank.withdraw();
        require(address(bank).balance == 5 && bank.deposits(address(1)) == 5, "failed payout changed balances");
        address[] memory expected = new address[](1);
        expected[0] = address(1);
        _assertRanking(expected);

        rejectPayment = false;
        tryReentry = true;
        uint256 beforeBalance = address(this).balance;
        bank.withdraw();
        require(address(this).balance == beforeBalance + 5 && address(bank).balance == 0, "retry failed");
        _assertRanking(expected);
    }

    /// @notice 随机存款序列逐笔对照全用户排序，验证前 10 名、金额、唯一性和链表终止。
    /// @dev 参考模型独立排序全部 16 人；同额按达到当前累计金额的步骤先后排序。
    function testFuzzMatchesFullSortAfterEveryDeposit(uint256 seed) public {
        uint256[16] memory totals;
        uint256[16] memory reachedAt;
        for (uint256 step; step < 32; step++) {
            uint256 random = uint256(keccak256(abi.encode(seed, step)));
            // 前 16 步保证所有用户出现，后 16 步随机追加，覆盖榜满与重复入榜。
            uint256 user = step < 16 ? step : random % 16;
            uint256 amount = (random >> 8) % 100 + 1;
            totals[user] += amount;
            reachedAt[user] = step + 1;
            _deposit(address(uint160(user + 100)), amount);

            uint256[16] memory order;
            for (uint256 i; i < 16; i++) {
                order[i] = i;
            }
            // 对所有用户做简单选择排序，与生产合约的局部链表插入算法独立。
            for (uint256 i; i < 16; i++) {
                for (uint256 j = i + 1; j < 16; j++) {
                    uint256 a = order[i];
                    uint256 b = order[j];
                    if (totals[b] > totals[a] || (totals[b] == totals[a] && reachedAt[b] < reachedAt[a])) {
                        (order[i], order[j]) = (b, a);
                    }
                }
            }
            address[] memory expected = new address[](step < 10 ? step + 1 : 10);
            for (uint256 i; i < expected.length; i++) {
                expected[i] = address(uint160(order[i] + 100));
            }
            _assertRanking(expected);
            for (uint256 i; i < 16; i++) {
                require(bank.deposits(address(uint160(i + 100))) == totals[i], "wrong deposit history");
            }
        }
    }

    /// @notice 模拟管理员收款、拒收和重入；必须命中重入错误，不能把余额为零误当保护生效。
    receive() external payable {
        require(!rejectPayment, "Admin rejected payment");
        if (tryReentry) {
            (bool success, bytes memory reason) = address(bank).call(abi.encodeCall(Bank.withdraw, ()));
            require(!success, "reentrant withdrawal succeeded");
            require(
                keccak256(reason) == keccak256(abi.encodeWithSignature("Error(string)", "Reentrant withdrawal")),
                "wrong reentry failure"
            );
        }
    }

    /// @dev 为指定模拟用户补足本次金额并存款，无需私钥或外部 RPC。
    function _deposit(address user, uint256 amount) private {
        vm.deal(user, amount);
        vm.prank(user);
        bank.deposit{value: amount}();
    }

    /// @dev 同时验证批量查询、逐节点迭代、人数、金额及终止节点。
    function _assertRanking(address[] memory expected) private view {
        (address[] memory accounts, uint256[] memory amounts) = bank.getTop10();
        require(bank.size() == expected.length && accounts.length == expected.length, "wrong list size");
        require(amounts.length == expected.length, "wrong amounts size");
        address current = bank.next(address(0));
        for (uint256 i; i < expected.length; i++) {
            require(current == expected[i] && accounts[i] == current, "wrong ranking");
            require(amounts[i] == bank.deposits(current), "wrong ranked amount");
            current = bank.next(current);
        }
        require(current == address(0), "list must terminate without extra nodes");
    }
}
