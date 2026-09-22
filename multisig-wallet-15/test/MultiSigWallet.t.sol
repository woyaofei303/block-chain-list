// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MultiSigWallet} from "../src/MultiSigWallet.sol";

// 沿用仓库的无第三方测试库方式，只声明实际需要的 cheatcode。
interface WalletVm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function expectRevert(bytes calldata reason) external;
}

contract CallTarget {
    uint256 public number;
    address public caller;
    bool public reject;

    function setReject(bool value) external {
        reject = value;
    }

    function record(uint256 value) external payable {
        require(!reject, "Target rejected");
        number = value;
        caller = msg.sender;
    }
}

contract ReentrantRecipient {
    uint256 public calls;
    bool public reentrySucceeded;

    receive() external payable {
        calls++;
        if (calls == 1) {
            // 此测试的提款提案编号为 0；尝试在收款回调中再次执行它。
            (reentrySucceeded,) = msg.sender.call(abi.encodeCall(MultiSigWallet.executeTransaction, (0)));
        }
    }
}

contract MultiSigWalletTest {
    WalletVm private constant vm = WalletVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CAROL = address(0xCA401);
    address private constant DAVE = address(0xDA7E);
    MultiSigWallet private wallet;

    function setUp() public {
        wallet = new MultiSigWallet(_owners(), 2);
        vm.deal(address(this), 10 ether);
        (bool funded,) = address(wallet).call{value: 2 ether}("");
        require(funded && address(wallet).balance == 2 ether, "Wallet funding failed");
    }

    function testConstructorValidatesOwnersAndThreshold() public {
        require(wallet.required() == 2, "Wrong threshold");
        require(keccak256(abi.encode(wallet.getOwners())) == keccak256(abi.encode(_owners())), "Wrong owners");
        require(wallet.isOwner(ALICE) && wallet.isOwner(BOB) && wallet.isOwner(CAROL), "Owner missing");
        require(!wallet.isOwner(address(this)), "Deployer must not gain ownership");

        address[] memory members = new address[](0);
        vm.expectRevert(bytes("Owners required"));
        new MultiSigWallet(members, 1);

        members = _owners();
        vm.expectRevert(bytes("Invalid confirmation threshold"));
        new MultiSigWallet(members, 0);
        vm.expectRevert(bytes("Invalid confirmation threshold"));
        new MultiSigWallet(members, 4);

        members[1] = address(0);
        vm.expectRevert(bytes("Invalid owner"));
        new MultiSigWallet(members, 2);
        members[1] = ALICE;
        vm.expectRevert(bytes("Duplicate owner"));
        new MultiSigWallet(members, 2);
    }

    function testEthTransferPermissionsThresholdAndReplay() public {
        vm.expectRevert(bytes("Not owner"));
        wallet.submitTransaction(DAVE, 1 ether, "");
        uint256 txId = _submit(DAVE, 1 ether, "");
        require(txId == 0 && wallet.getTransactionCount() == 1, "Wrong proposal ID");
        (address to, uint256 value, bytes memory data, bool executed, uint256 count) = wallet.transactions(txId);
        require(to == DAVE && value == 1 ether && data.length == 0, "Wrong proposal contents");
        require(!executed && count == 0 && !wallet.isConfirmed(txId, ALICE), "Submission must not confirm");

        vm.expectRevert(bytes("Not owner"));
        wallet.confirmTransaction(txId);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);

        vm.prank(BOB);
        wallet.confirmTransaction(txId);
        vm.expectRevert(bytes("Already confirmed"));
        vm.prank(BOB);
        wallet.confirmTransaction(txId);
        _assertState(txId, false, 1);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
        require(DAVE.balance == 0 && address(wallet).balance == 2 ether, "Paid before threshold");

        vm.prank(CAROL);
        wallet.confirmTransaction(txId);
        // DAVE 不属于持有人；仍可执行已经由 BOB、CAROL 批准的提案。
        vm.prank(DAVE);
        wallet.executeTransaction(txId);
        _assertState(txId, true, 2);
        require(DAVE.balance == 1 ether && address(wallet).balance == 1 ether, "Wrong ETH transfer");

        vm.expectRevert(bytes("Transaction already executed"));
        wallet.executeTransaction(txId);
        vm.expectRevert(bytes("Transaction already executed"));
        vm.prank(ALICE);
        wallet.confirmTransaction(txId);
        _assertState(txId, true, 2);
        require(DAVE.balance == 1 ether, "Proposal paid twice");
    }

    function testInvalidProposalInputs() public {
        vm.expectRevert(bytes("Invalid destination"));
        vm.prank(ALICE);
        wallet.submitTransaction(address(0), 1 ether, "");
        require(wallet.getTransactionCount() == 0, "Invalid proposal persisted");

        vm.expectRevert(bytes("Transaction does not exist"));
        vm.prank(ALICE);
        wallet.confirmTransaction(0);
        vm.expectRevert(bytes("Transaction does not exist"));
        wallet.executeTransaction(type(uint256).max);
    }

    function testConfirmationsArePerProposalAndCanExceedThreshold() public {
        uint256 first = _submit(DAVE, 0, "");
        uint256 second = _submit(DAVE, 0, "");
        require(first == 0 && second == 1 && wallet.getTransactionCount() == 2, "IDs must be sequential");
        vm.prank(ALICE);
        wallet.confirmTransaction(first);
        vm.prank(BOB);
        wallet.confirmTransaction(second);
        require(!wallet.isConfirmed(second, ALICE) && !wallet.isConfirmed(first, BOB), "Confirmation leaked");
        _assertState(first, false, 1);
        _assertState(second, false, 1);

        vm.prank(BOB);
        wallet.confirmTransaction(first);
        vm.prank(CAROL);
        wallet.confirmTransaction(first);
        wallet.executeTransaction(first);
        _assertState(first, true, 3);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(second);
        _assertState(second, false, 1);
    }

    function testContractCallForwardsValueDataAndWalletIdentity() public {
        CallTarget target = new CallTarget();
        bytes memory data = abi.encodeCall(CallTarget.record, (42));
        uint256 txId = _submit(address(target), 1 ether, data);
        (,, bytes memory storedData,,) = wallet.transactions(txId);
        require(keccak256(storedData) == keccak256(data), "Calldata changed");
        _approve(txId);
        wallet.executeTransaction(txId);
        require(target.number() == 42 && target.caller() == address(wallet), "Wrong contract call");
        require(address(target).balance == 1 ether && address(wallet).balance == 1 ether, "Wrong call value");
        _assertState(txId, true, 2);
    }

    function testRevertedCallPreservesConfirmationsAndCanRetry() public {
        CallTarget target = new CallTarget();
        target.setReject(true);
        uint256 txId = _submit(address(target), 1 ether, abi.encodeCall(CallTarget.record, (42)));
        _approve(txId);
        vm.expectRevert(bytes("Transaction call failed"));
        wallet.executeTransaction(txId);
        _assertState(txId, false, 2);
        require(wallet.isConfirmed(txId, ALICE) && wallet.isConfirmed(txId, BOB), "Approvals lost");
        require(address(wallet).balance == 2 ether && address(target).balance == 0, "Failed call moved funds");
        require(target.number() == 0, "Failed call changed target");

        target.setReject(false);
        wallet.executeTransaction(txId);
        _assertState(txId, true, 2);
        require(target.number() == 42 && address(target).balance == 1 ether, "Retry failed");
    }

    function testInsufficientBalanceCanRetryAfterFunding() public {
        uint256 txId = _submit(DAVE, 3 ether, "");
        _approve(txId);
        vm.expectRevert(bytes("Insufficient balance"));
        wallet.executeTransaction(txId);
        _assertState(txId, false, 2);
        require(address(wallet).balance == 2 ether && DAVE.balance == 0, "Failed payment changed balances");

        (bool funded,) = address(wallet).call{value: 1 ether}("");
        require(funded, "Top-up failed");
        wallet.executeTransaction(txId);
        _assertState(txId, true, 2);
        require(DAVE.balance == 3 ether && address(wallet).balance == 0, "Retry did not spend full balance");
    }

    function testSameProposalCannotReenter() public {
        ReentrantRecipient recipient = new ReentrantRecipient();
        uint256 txId = _submit(address(recipient), 1 ether, "");
        _approve(txId);
        wallet.executeTransaction(txId);
        require(!recipient.reentrySucceeded() && recipient.calls() == 1, "Reentry executed proposal twice");
        require(address(recipient).balance == 1 ether && address(wallet).balance == 1 ether, "Reentry drained wallet");
        _assertState(txId, true, 2);
    }

    function testSingleOwnerAndUnanimousThresholds() public {
        address[] memory soleOwner = new address[](1);
        soleOwner[0] = ALICE;
        wallet = new MultiSigWallet(soleOwner, 1);
        uint256 txId = _submit(DAVE, 0, "");
        vm.prank(ALICE);
        wallet.confirmTransaction(txId);
        wallet.executeTransaction(txId);
        _assertState(txId, true, 1);

        wallet = new MultiSigWallet(_owners(), 3);
        txId = _submit(DAVE, 0, "");
        _approve(txId);
        vm.expectRevert(bytes("Not enough confirmations"));
        wallet.executeTransaction(txId);
        vm.prank(CAROL);
        wallet.confirmTransaction(txId);
        wallet.executeTransaction(txId);
        _assertState(txId, true, 3);
    }

    function _owners() private pure returns (address[] memory members) {
        members = new address[](3);
        members[0] = ALICE;
        members[1] = BOB;
        members[2] = CAROL;
    }

    function _submit(address to, uint256 value, bytes memory data) private returns (uint256) {
        vm.prank(ALICE);
        return wallet.submitTransaction(to, value, data);
    }

    function _approve(uint256 txId) private {
        vm.prank(ALICE);
        wallet.confirmTransaction(txId);
        vm.prank(BOB);
        wallet.confirmTransaction(txId);
    }

    function _assertState(uint256 txId, bool expectedExecuted, uint256 expectedCount) private view {
        (,,, bool executed, uint256 count) = wallet.transactions(txId);
        require(executed == expectedExecuted && count == expectedCount, "Unexpected proposal state");
    }
}
