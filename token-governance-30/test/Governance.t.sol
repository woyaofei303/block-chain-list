// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {GovToken} from "../src/GovToken.sol";
import {Gov} from "../src/Gov.sol";
import {Bank} from "../src/Bank.sol";

contract GovernanceTest is Test {
    GovToken internal token;
    Gov internal gov;
    Bank internal bank;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address payable internal recipient = payable(makeAddr("recipient"));
    string internal constant DESCRIPTION = "Pay 2 ETH for development";
    address[] internal targets;
    uint256[] internal values;
    bytes[] internal calldatas;

    /// @notice 分配 60/30/9/1 万 GTK 并激活票权；向真实 Bank 存入 10 ETH，再进入下一块。
    function setUp() public {
        vm.roll(100);
        token = new GovToken(alice);
        gov = new Gov(token);
        bank = new Bank(address(gov));
        vm.startPrank(alice);
        token.transfer(bob, 300_000 ether);
        token.transfer(carol, 90_000 ether);
        token.transfer(dave, 10_000 ether);
        token.delegate(alice);
        vm.stopPrank();
        vm.prank(bob);
        token.delegate(bob);
        vm.prank(carol);
        token.delegate(carol);
        vm.prank(dave);
        token.delegate(dave);
        vm.deal(address(this), 10 ether);
        (bool sent,) = address(bank).call{value: 10 ether}("");
        assertTrue(sent);
        vm.roll(101);
        targets.push(address(bank));
        values.push(0);
        calldatas.push(abi.encodeCall(Bank.withdraw, (recipient, 2 ether)));
    }

    /// @notice 验证真实提案、加权投票、任何人触发执行，以及 Gov 到 Bank 的管理员调用和资金终点。
    function testProposalVoteAndExecute() public {
        assertEq(bank.admin(), address(gov));
        uint256 id = _propose();
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Pending));
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        assertEq(gov.castVote(id, 1), 600_000 ether);
        vm.prank(bob);
        gov.castVote(id, 0);
        vm.prank(carol);
        gov.castVote(id, 2);
        (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) = gov.proposalVotes(id);
        assertEq(againstVotes, 300_000 ether);
        assertEq(forVotes, 600_000 ether);
        assertEq(abstainVotes, 90_000 ether);
        vm.roll(gov.proposalDeadline(id) + 1);
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Succeeded));
        vm.prank(makeAddr("executorWithoutTokens"));
        _execute();
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Executed));
        assertEq(address(bank).balance, 8 ether);
        assertEq(recipient.balance, 2 ether);
        assertEq(address(gov).balance, 0);
    }

    /// @notice 持币人与部署者都不能直接提款，Bank 只接受 Gov 发起的调用。
    function testOnlyGovernorCanWithdraw() public {
        vm.expectRevert(abi.encodeWithSelector(Bank.Unauthorized.selector, alice));
        vm.prank(alice);
        bank.withdraw(recipient, 2 ether);
        vm.expectRevert(abi.encodeWithSelector(Bank.Unauthorized.selector, address(this)));
        bank.withdraw(recipient, 2 ether);
        assertEq(address(bank).balance, 10 ether);
    }

    /// @notice 无历史票权不能提案；当前块才委托也不满足前一块的提案门槛。
    function testProposalRequiresPastDelegatedVotes() public {
        address newcomer = makeAddr("newcomer");
        vm.prank(alice);
        token.transfer(newcomer, 1 ether);
        vm.prank(newcomer);
        token.delegate(newcomer);
        vm.expectRevert(
            abi.encodeWithSelector(IGovernor.GovernorInsufficientProposerVotes.selector, newcomer, 0, 1 ether)
        );
        vm.prank(newcomer);
        gov.propose(targets, values, calldatas, DESCRIPTION);
        vm.roll(block.number + 1);
        vm.prank(newcomer);
        gov.propose(targets, values, calldatas, DESCRIPTION);
    }

    /// @notice 空动作无法成为可执行提案，避免提交无意义的治理操作。
    function testRejectEmptyProposal() public {
        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorInvalidProposalLength.selector, 0, 0, 0));
        vm.prank(alice);
        gov.propose(new address[](0), new uint256[](0), new bytes[](0), DESCRIPTION);
    }

    /// @notice 完全相同的动作和描述绑定同一 ID，不能重复创建提案。
    function testRejectDuplicateProposal() public {
        _propose();
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        _propose();
    }

    /// @notice 快照块仍为 Pending，截止块仍为 Active；执行必须等到截止块之后。
    function testVotingAndExecutionBlockBoundaries() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id));
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        vm.prank(alice);
        gov.castVote(id, 1);
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 1);
        vm.roll(gov.proposalDeadline(id));
        vm.prank(bob);
        gov.castVote(id, 0);
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        _execute();
        vm.roll(gov.proposalDeadline(id) + 1);
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        vm.prank(carol);
        gov.castVote(id, 1);
        _execute();
        assertEq(recipient.balance, 2 ether);
    }

    /// @notice 同一地址在同一提案只能投一次，重复投票不会增加赞成票。
    function testRejectDoubleVote() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 1);
        vm.expectRevert(abi.encodeWithSelector(IGovernor.GovernorAlreadyCastVote.selector, alice));
        vm.prank(alice);
        gov.castVote(id, 1);
        (, uint256 votes,) = gov.proposalVotes(id);
        assertEq(votes, 600_000 ether);
    }

    /// @notice 非法选项回滚 hasVoted 标记，用户随后仍能提交一张有效票。
    function testInvalidVoteDoesNotConsumeVote() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.expectRevert(IGovernor.GovernorInvalidVoteType.selector);
        vm.prank(alice);
        gov.castVote(id, 3);
        assertFalse(gov.hasVoted(id, alice));
        vm.prank(alice);
        gov.castVote(id, 1);
        assertTrue(gov.hasVoted(id, alice));
    }

    /// @notice 投完后转币给 Bob，Bob 仍只能用快照时的 30 万票，不能重复使用 Alice 的 60 万票。
    function testTransferAfterSnapshotCannotDoubleCount() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.startPrank(alice);
        gov.castVote(id, 1);
        token.transfer(bob, 600_000 ether);
        vm.stopPrank();
        assertEq(token.getVotes(bob), 900_000 ether);
        vm.prank(bob);
        assertEq(gov.castVote(id, 1), 300_000 ether);
        (, uint256 votes,) = gov.proposalVotes(id);
        assertEq(votes, 900_000 ether);
    }

    /// @notice 快照后更换代表只影响以后提案；本次票权仍分别属于 Alice 和 Bob。
    function testRedelegationAfterSnapshotCannotDoubleCount() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        token.delegate(bob);
        vm.prank(alice);
        assertEq(gov.castVote(id, 1), 600_000 ether);
        vm.prank(bob);
        assertEq(gov.castVote(id, 1), 300_000 ether);
    }

    /// @notice 快照块内借入、委托并归还，块末票权归零，下一块不能凭临时余额增加票数。
    function testSameBlockBorrowAndReturnHasNoSnapshotVotes() public {
        uint256 id = _propose();
        address borrower = makeAddr("borrower");
        vm.roll(gov.proposalSnapshot(id));
        vm.prank(alice);
        token.transfer(borrower, 600_000 ether);
        vm.startPrank(borrower);
        token.delegate(borrower);
        token.transfer(alice, 600_000 ether);
        vm.stopPrank();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(borrower);
        assertEq(gov.castVote(id, 1), 0);
        (, uint256 votes,) = gov.proposalVotes(id);
        assertEq(votes, 0);
    }

    /// @notice 持有余额但快照时未委托，之后补委托也不能为已有提案补票。
    function testUndelegatedBalanceHasNoVotes() public {
        vm.prank(alice);
        token.delegate(address(0));
        vm.roll(block.number + 1);
        vm.prank(bob);
        uint256 id = gov.propose(targets, values, calldatas, DESCRIPTION);
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        token.delegate(alice);
        vm.prank(alice);
        assertEq(gov.castVote(id, 1), 0);
    }

    /// @notice 只有 9 万赞成票虽无人反对，仍未达到 10 万的法定票数，不能执行。
    function testInsufficientQuorumDefeatsProposal() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(carol);
        gov.castVote(id, 1);
        _assertDefeated(id);
    }

    /// @notice 9 万赞成加 1 万弃权刚好达到门槛；弃权计入参会数量但不作为赞成票。
    function testAbstainCountsTowardExactQuorum() public {
        uint256 id = _propose();
        assertEq(gov.quorum(block.number - 1), 100_000 ether);
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(carol);
        gov.castVote(id, 1);
        vm.prank(dave);
        gov.castVote(id, 2);
        vm.roll(gov.proposalDeadline(id) + 1);
        _execute();
        assertEq(recipient.balance, 2 ether);
    }

    /// @notice 只有弃权票即使满足法定票数，赞成不多于反对，提案仍失败。
    function testOnlyAbstainDefeatsProposal() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 2);
        _assertDefeated(id);
    }

    /// @notice 反对票多于赞成票时失败；反对票也不能替代赞成加弃权的法定票数。
    function testMajorityAgainstDefeatsProposal() public {
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 0);
        vm.prank(bob);
        gov.castVote(id, 1);
        _assertDefeated(id);
    }

    /// @notice 双方恰好各 30 万票也不通过，必须严格多数赞成。
    function testTieDefeatsProposal() public {
        vm.prank(alice);
        token.transfer(makeAddr("nonvoter"), 300_000 ether);
        uint256 id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 1);
        vm.prank(bob);
        gov.castVote(id, 0);
        _assertDefeated(id);
    }

    /// @notice 无人投票的提案不能执行，Bank 资金保持不变。
    function testNoVotesDefeatsProposal() public {
        _assertDefeated(_propose());
    }

    /// @notice 执行过的提案不能再次支付，即使触发者不同也一样。
    function testRejectDoubleExecution() public {
        _passProposal();
        _execute();
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        _execute();
        assertEq(address(bank).balance, 8 ether);
        assertEq(recipient.balance, 2 ether);
    }

    /// @notice 执行时替换金额或描述会对应另一个 ID，不能借已通过的票授权不同动作。
    function testExecutionBindsCalldataAndDescription() public {
        uint256 id = _passProposal();
        calldatas[0] = abi.encodeCall(Bank.withdraw, (recipient, 3 ether));
        vm.expectPartialRevert(IGovernor.GovernorNonexistentProposal.selector);
        _execute();
        calldatas[0] = abi.encodeCall(Bank.withdraw, (recipient, 2 ether));
        vm.expectPartialRevert(IGovernor.GovernorNonexistentProposal.selector);
        gov.execute(targets, values, calldatas, keccak256("changed description"));
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Succeeded));
        assertEq(address(bank).balance, 10 ether);
    }

    /// @notice 合法提案余额不足时，执行标记也回滚；之后补足金库可重试同一提案。
    function testInsufficientFundsRollBackAndCanRetry() public {
        calldatas[0] = abi.encodeCall(Bank.withdraw, (recipient, 11 ether));
        uint256 id = _passProposal();
        vm.expectRevert(Bank.InsufficientBalance.selector);
        _execute();
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Succeeded));
        assertEq(address(bank).balance, 10 ether);
        assertEq(recipient.balance, 0);
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(bank).call{value: 1 ether}("");
        assertTrue(sent);
        _execute();
        assertEq(recipient.balance, 11 ether);
        assertEq(address(bank).balance, 0);
    }

    /// @notice 接收合约拒收会让支付和提案执行一起回滚，接收方恢复后可重试。
    function testRejectingRecipientRollsBackAndCanRetry() public {
        ToggleReceiver receiver = new ToggleReceiver();
        calldatas[0] = abi.encodeCall(Bank.withdraw, (payable(address(receiver)), 2 ether));
        uint256 id = _passProposal();
        vm.expectRevert(Bank.TransferFailed.selector);
        _execute();
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Succeeded));
        assertEq(address(bank).balance, 10 ether);
        assertEq(address(receiver).balance, 0);
        receiver.accept();
        _execute();
        assertEq(address(receiver).balance, 2 ether);
    }

    /// @notice 批量提案中第二笔失败，第一笔已经发生的支付也必须回滚。
    function testBatchExecutionIsAtomic() public {
        targets.push(address(bank));
        values.push(0);
        calldatas.push(abi.encodeCall(Bank.withdraw, (recipient, 9 ether)));
        uint256 id = _passProposal();
        vm.expectRevert(Bank.InsufficientBalance.selector);
        _execute();
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Succeeded));
        assertEq(address(bank).balance, 10 ether);
        assertEq(recipient.balance, 0);
    }

    /// @notice 接收回调重入执行同一提案会被 Governor 的已执行状态拒绝，仅支付一次。
    function testRecipientCannotReenterSameProposal() public {
        ReentrantReceiver receiver = new ReentrantReceiver(gov, bank);
        calldatas[0] = abi.encodeCall(Bank.withdraw, (payable(address(receiver)), 2 ether));
        _passProposal();
        _execute();
        assertTrue(receiver.blocked());
        assertEq(address(receiver).balance, 2 ether);
        assertEq(address(bank).balance, 8 ether);
    }

    /// @notice 非法管理员和投票 Token 在部署时被拒绝，不能建立明显不可工作的治理实例。
    function testRejectInvalidDeploymentAddresses() public {
        vm.expectRevert(Bank.InvalidAddress.selector);
        new Bank(address(0));
        vm.expectRevert(bytes("invalid token"));
        new Gov(GovToken(address(0)));
    }

    /// @notice 即使管理员身份正确，提款也不能使用零地址或零金额。
    function testWithdrawValidatesRecipientAndAmount() public {
        vm.expectRevert(Bank.InvalidAddress.selector);
        vm.prank(address(gov));
        bank.withdraw(payable(address(0)), 1 ether);
        vm.expectRevert(Bank.InvalidAmount.selector);
        vm.prank(address(gov));
        bank.withdraw(recipient, 0);
        assertEq(address(bank).balance, 10 ether);
    }

    /// @notice 任意余额范围内的提款，经真实提案通过后应守恒：金库减少多少，接收人增加多少。
    function testFuzzApprovedWithdrawalConservesETH(uint256 amount) public {
        amount = bound(amount, 1, 10 ether);
        calldatas[0] = abi.encodeCall(Bank.withdraw, (recipient, amount));
        _passProposal();
        _execute();
        assertEq(address(bank).balance, 10 ether - amount);
        assertEq(recipient.balance, amount);
    }

    /// @notice 将已投票的提案推进到结束，核对失败状态、无法执行以及资金未被移动。
    function _assertDefeated(uint256 id) internal {
        vm.roll(gov.proposalDeadline(id) + 1);
        assertEq(uint256(gov.state(id)), uint256(IGovernor.ProposalState.Defeated));
        vm.expectPartialRevert(IGovernor.GovernorUnexpectedProposalState.selector);
        _execute();
        assertEq(address(bank).balance, 10 ether);
        assertEq(recipient.balance, 0);
    }

    /// @notice Alice 的 60 万票足以通过当前动作，返回结束投票后的提案 ID。
    function _passProposal() internal returns (uint256 id) {
        id = _propose();
        vm.roll(gov.proposalSnapshot(id) + 1);
        vm.prank(alice);
        gov.castVote(id, 1);
        vm.roll(gov.proposalDeadline(id) + 1);
    }

    /// @notice Alice 用已委托的历史票权提交当前动作；返回内容绑定的提案 ID。
    function _propose() internal returns (uint256) {
        vm.prank(alice);
        return gov.propose(targets, values, calldatas, DESCRIPTION);
    }

    /// @notice 以当前动作与原描述哈希执行；不替调用者提权，也不额外转入 ETH。
    function _execute() internal {
        gov.execute(targets, values, calldatas, keccak256(bytes(DESCRIPTION)));
    }
}

/// @notice 仅供测试：先拒收，显式切换后接受 ETH，用于验证失败回滚与重试。
contract ToggleReceiver {
    bool internal accepting;

    /// @notice 测试接收方切换为可收款；无生产权限含义。
    function accept() external {
        accepting = true;
    }

    /// @notice 未切换时拒收，使 Bank 的外部转账返回失败。
    receive() external payable {
        require(accepting, "not accepting");
    }
}

/// @notice 仅供测试：收款时尝试重入当前提案，记录是否被状态检查拒绝。
contract ReentrantReceiver {
    Gov internal immutable gov;
    Bank internal immutable bank;
    bool public blocked;

    /// @notice 绑定本测试部署的 Gov 与 Bank，不读取或调用外部链。
    constructor(Gov gov_, Bank bank_) {
        gov = gov_;
        bank = bank_;
    }

    /// @notice 重建同一提款动作，核对拒绝原因是提案状态；主测试另断言只支付一次。
    receive() external payable {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(bank);
        calldatas[0] = abi.encodeCall(Bank.withdraw, (payable(address(this)), 2 ether));
        try gov.execute(targets, values, calldatas, keccak256("Pay 2 ETH for development")) {}
        catch (bytes memory reason) {
            blocked = bytes4(reason) == IGovernor.GovernorUnexpectedProposalState.selector;
        }
    }
}
