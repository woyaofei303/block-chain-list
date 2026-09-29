// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AirdopMerkleNFTMarket} from "../src/AirdopMerkleNFTMarket.sol";
import {PermitToken} from "../src/PermitToken.sol";
import {MarketNFT} from "../src/MarketNFT.sol";

contract AirdopMerkleNFTMarketTest is Test {
    PermitToken internal token;
    MarketNFT internal nft;
    AirdopMerkleNFTMarket internal market;
    address internal buyer;
    uint256 internal buyerKey;
    address internal seller = makeAddr("seller");
    address internal other = makeAddr("other whitelist member");
    bytes32 internal otherLeaf;

    /// @notice 每项测试独立部署 Token、NFT 和双叶白名单，卖家按 100 Token 上架 #0。
    function setUp() public {
        (buyer, buyerKey) = makeAddrAndKey("buyer");
        token = new PermitToken();
        nft = new MarketNFT();
        otherLeaf = keccak256(bytes.concat(keccak256(abi.encode(other))));
        bytes32 buyerLeaf = keccak256(bytes.concat(keccak256(abi.encode(buyer))));
        bytes32 root = buyerLeaf < otherLeaf
            ? keccak256(abi.encodePacked(buyerLeaf, otherLeaf))
            : keccak256(abi.encodePacked(otherLeaf, buyerLeaf));
        market = new AirdopMerkleNFTMarket(address(token), address(nft), root);
        token.transfer(buyer, 1_000 ether);
        nft.mint(seller);
        vm.startPrank(seller);
        nft.approve(address(market), 0);
        market.list(0, 100 ether);
        vm.stopPrank();
    }

    /// @notice 一次 multicall 保留买家身份，先 Permit 再以五折付款，清空挂单及恰好用完的额度。
    function testMulticallBuysAtHalfPriceWithoutApprove() public {
        assertEq(token.allowance(buyer, address(market)), 0);
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        market.multicall(calls);
        assertEq(nft.ownerOf(0), buyer);
        assertEq(token.balanceOf(buyer), 950 ether);
        assertEq(token.balanceOf(seller), 50 ether);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(token.allowance(buyer, address(market)), 0);
        assertEq(token.nonces(buyer), 1);
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, address(0));
        assertEq(price, 0);
    }

    /// @notice 错误证明使第二步失败，第一步成功的 Permit 也不能留下 nonce 或额度。
    function testInvalidProofRollsBackPermit() public {
        bytes32[] memory proof = _proof();
        proof[0] = bytes32(uint256(1));
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, proof);
        vm.prank(buyer);
        vm.expectRevert("Not whitelisted");
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 证明必须属于实际调用者；白名单地址不是可自由指定的 NFT 接收者。
    function testOutsiderCannotUseBuyerProof() public {
        address outsider = makeAddr("outsider");
        vm.prank(outsider);
        vm.expectRevert("Not whitelisted");
        market.claimNFT(0, 50 ether, _proof());
        _assertUnchanged();
    }

    /// @notice 另一名白名单用户也不能利用买家的 Permit，因为 owner 绑定 msg.sender。
    function testStolenPermitCannotAuthorizeAnotherCaller() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(other);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 改动签名金额或切换 chainId 会使签名失效，余额与 nonce 不得改变。
    function testTamperedAndWrongChainPermitRevert() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        calls[0][35] = bytes1(uint8(calls[0][35]) ^ 1);
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
        calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.chainId(block.chainid + 1);
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice Permit 的时间窗口结束后，两步批量购买都不能执行。
    function testExpiredPermitReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes[] memory calls = _calls(50 ether, deadline, _proof());
        vm.warp(deadline + 1);
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 同一 Permit 签名只消耗一次 nonce，重放不得再扣款。
    function testPermitReplayReverts() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.startPrank(buyer);
        market.multicall(calls);
        vm.expectRevert();
        market.multicall(calls);
        vm.stopPrank();
        assertEq(token.nonces(buyer), 1);
        assertEq(token.balanceOf(buyer), 950 ether);
        assertEq(nft.ownerOf(0), buyer);
    }

    /// @notice 任意人可提前向 Token 提交公开 Permit；买家可跳过重复 Permit，单独 claim。
    function testAlreadySubmittedPermitCanUseClaimDirectly() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            abi.decode(_arguments(calls[0]), (uint256, uint256, uint8, bytes32, bytes32));
        token.permit(buyer, address(market), value, deadline, v, r, s);
        vm.prank(buyer);
        market.claimNFT(0, 50 ether, _proof());
        assertEq(nft.ownerOf(0), buyer);
        assertEq(token.nonces(buyer), 1);
    }

    /// @notice 第二步额度不足会撤销刚建立的 Permit；最高支付额与 Permit 额度分别检查。
    function testInsufficientAllowanceRollsBack() public {
        bytes[] memory calls = _calls(49 ether, block.timestamp + 1 hours, _proof());
        calls[1] = abi.encodeCall(market.claimNFT, (0, 50 ether, _proof()));
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice Token 余额不足时，挂单与 NFT 所有权保留，Permit 的副作用也回滚。
    function testInsufficientBalanceRollsBack() public {
        vm.prank(buyer);
        token.transfer(other, 1_000 ether);
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.nonces(buyer), 0);
        assertEq(token.allowance(buyer, address(market)), 0);
        assertEq(nft.ownerOf(0), seller);
        (address listedSeller,) = market.listings(0);
        assertEq(listedSeller, seller);
    }

    /// @notice 卖家撤销授权导致 NFT 转移失败时，已发生的 Token 扣款必须一并撤销。
    function testRevokedNftApprovalRollsBackPaymentAndPermit() public {
        vm.prank(seller);
        nft.approve(address(0), 0);
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 卖家将 NFT 转出后旧挂单不能成交，买家不会为无效挂单付费。
    function testStaleListingRevertsWithoutPayment() public {
        vm.prank(seller);
        nft.transferFrom(seller, other, 0);
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        assertEq(nft.ownerOf(0), other);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.nonces(buyer), 0);
    }

    /// @notice 卖家在签名后提价时，购买上限阻止多扣款并恢复 Permit 状态。
    function testPriceIncreaseExceedsBuyerMaximum() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        vm.prank(seller);
        market.list(0, 102 ether);
        vm.prank(buyer);
        vm.expectRevert("Price exceeds maximum");
        market.multicall(calls);
        assertEq(token.nonces(buyer), 0);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.allowance(buyer, address(market)), 0);
        (, uint256 price) = market.listings(0);
        assertEq(price, 102 ether);
    }

    /// @notice 同一批次购买两次时最后一次失败，前一次成交和 Permit 也整体回滚。
    function testDuplicateClaimRollsBackWholeBatch() public {
        bytes[] memory first = _calls(50 ether, block.timestamp + 1 hours, _proof());
        bytes[] memory calls = new bytes[](3);
        calls[0] = first[0];
        calls[1] = first[1];
        calls[2] = first[1];
        vm.prank(buyer);
        vm.expectRevert("NFT not listed");
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 未授权时颠倒顺序会失败；购买依赖前一个 delegatecall 设置的额度。
    function testClaimBeforePermitReverts() public {
        bytes[] memory calls = _calls(50 ether, block.timestamp + 1 hours, _proof());
        (calls[0], calls[1]) = (calls[1], calls[0]);
        vm.prank(buyer);
        vm.expectRevert();
        market.multicall(calls);
        _assertUnchanged();
    }

    /// @notice 非持有人、零价或未授权上架均失败；全量授权与更新报价可用，NFT 仍在卖家钱包。
    function testListingChecksAndApprovalForAll() public {
        vm.prank(buyer);
        vm.expectRevert("Only NFT owner");
        market.list(0, 100 ether);
        vm.startPrank(seller);
        vm.expectRevert("Price must be positive");
        market.list(0, 0);
        nft.approve(address(0), 0);
        vm.expectRevert("Market not approved");
        market.list(0, 100 ether);
        nft.setApprovalForAll(address(market), true);
        market.list(0, 200 ether);
        vm.stopPrank();
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, seller);
        assertEq(price, 200 ether);
        assertEq(nft.ownerOf(0), seller);
    }

    /// @notice 对随机正数原价核验实际扣款的向上取整；包含原价 1 的非免费边界。
    function testFuzzHalfPriceRoundsUp(uint96 rawPrice) public {
        uint256 price = bound(uint256(rawPrice), 1, 1_000 ether);
        vm.prank(seller);
        market.list(0, price);
        uint256 paid = (price + 1) / 2;
        bytes[] memory calls = _calls(paid, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        market.multicall(calls);
        assertEq(token.balanceOf(seller), paid);
        assertEq(token.balanceOf(buyer), 1_000 ether - paid);
    }

    /// @notice uint256 最大报价的五折计算不溢出；会正常到达 Token 余额不足的检查。
    function testMaximumPriceDoesNotOverflow() public {
        vm.prank(seller);
        market.list(0, type(uint256).max);
        uint256 paid = type(uint256).max / 2 + 1;
        bytes[] memory calls = _calls(paid, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        vm.expectPartialRevert(bytes4(keccak256("ERC20InsufficientBalance(address,uint256,uint256)")));
        market.multicall(calls);
        assertEq(token.nonces(buyer), 0);
    }

    /// @notice 原价仅一个最小单位时仍收费一个单位，避免整数除法产生免费 NFT。
    function testOneUnitPriceIsNotFree() public {
        vm.prank(seller);
        market.list(0, 1);
        bytes[] memory calls = _calls(1, block.timestamp + 1 hours, _proof());
        vm.prank(buyer);
        market.multicall(calls);
        assertEq(token.balanceOf(seller), 1);
    }

    /// @notice NFT 只有管理员能铸造，非管理员失败后不能推进编号。
    function testMintRequiresOwner() public {
        vm.prank(buyer);
        vm.expectRevert();
        nft.mint(buyer);
        assertEq(nft.nextTokenId(), 1);
    }

    /// @notice 部署时拒绝空根、无代码 Token 与无代码 NFT。
    function testConstructorRejectsInvalidConfiguration() public {
        bytes32 root = market.merkleRoot();
        vm.expectRevert("Invalid payment token");
        new AirdopMerkleNFTMarket(address(0), address(nft), root);
        vm.expectRevert("Invalid NFT");
        new AirdopMerkleNFTMarket(address(token), address(0), root);
        vm.expectRevert("Empty root");
        new AirdopMerkleNFTMarket(address(token), address(nft), bytes32(0));
    }

    /// @notice NFT 接收回调中通过 multicall 重入 claim 也受锁保护，外层购买只付款一次。
    function testReceiverCannotReenterThroughMulticall() public {
        BuyerReceiver receiver = _receiverMarket();
        receiver.buy(token, market, false);
        assertTrue(receiver.reentryBlocked());
        assertEq(nft.ownerOf(0), address(receiver));
        assertEq(token.balanceOf(seller), 50 ether);
    }

    /// @notice 接收方拒绝 NFT 时，先前的付款与挂单删除全部回滚。
    function testRejectingReceiverRollsBack() public {
        BuyerReceiver receiver = _receiverMarket();
        vm.expectRevert("Reject NFT");
        receiver.buy(token, market, true);
        assertEq(nft.ownerOf(0), seller);
        assertEq(token.balanceOf(address(receiver)), 100 ether);
        assertEq(token.balanceOf(seller), 0);
        (address listedSeller,) = market.listings(0);
        assertEq(listedSeller, seller);
    }

    /// @notice 创建单地址白名单的合约买家；合约钱包走普通 approve，EIP-2612 仍针对 EOA。
    function _receiverMarket() internal returns (BuyerReceiver receiver) {
        receiver = new BuyerReceiver();
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(address(receiver)))));
        market = new AirdopMerkleNFTMarket(address(token), address(nft), root);
        token.transfer(address(receiver), 100 ether);
        vm.startPrank(seller);
        nft.approve(address(market), 0);
        market.list(0, 100 ether);
        vm.stopPrank();
    }

    /// @notice 对失败交易统一核验资金、所有权、挂单、Permit nonce 和额度全部未变。
    function _assertUnchanged() internal view {
        assertEq(token.nonces(buyer), 0);
        assertEq(token.allowance(buyer, address(market)), 0);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(nft.ownerOf(0), seller);
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, seller);
        assertEq(price, 100 ether);
    }

    /// @notice 去掉函数选择器，解码公开 Permit 参数以模拟第三方提前提交签名。
    function _arguments(bytes memory data) internal pure returns (bytes memory args) {
        args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; i++) {
            args[i] = data[i + 4];
        }
    }

    /// @notice 构造买家的证明；另一白名单成员的叶子即两叶树的唯一兄弟节点。
    function _proof() internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = otherLeaf;
    }

    /// @notice 使用测试虚拟机的内存账户签名，返回严格有序的 Permit 与购买 calldata。
    /// @dev owner 固定 buyer，spender 固定 market；不读取真实钱包或把密钥写入文件。
    function _calls(uint256 value, uint256 deadline, bytes32[] memory proof)
        internal
        view
        returns (bytes[] memory calls)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer,
                address(market),
                value,
                token.nonces(buyer),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerKey, keccak256(abi.encodePacked(hex"1901", token.DOMAIN_SEPARATOR(), structHash)));
        calls = new bytes[](2);
        calls[0] = abi.encodeCall(market.permitPrePay, (value, deadline, v, r, s));
        calls[1] = abi.encodeCall(market.claimNFT, (0, value, proof));
    }
}

/// @notice 仅测试使用的 NFT 接收合约，可拒收或尝试通过嵌套 multicall 重入。
contract BuyerReceiver {
    AirdopMerkleNFTMarket private market;
    bool private rejectNft;
    bool public reentryBlocked;

    /// @notice 使用自己的 Token 购买，reject 参数切换拒收场景。
    function buy(PermitToken token, AirdopMerkleNFTMarket target, bool reject) external {
        market = target;
        rejectNft = reject;
        token.approve(address(target), 50 ether);
        target.claimNFT(0, 50 ether, new bytes32[](0));
    }

    /// @notice 收到 NFT 时尝试重入；必须得到重入锁错误而非普通挂单错误。
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        require(!rejectNft, "Reject NFT");
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(market.claimNFT, (0, 50 ether, new bytes32[](0)));
        (bool success, bytes memory reason) = address(market).call(abi.encodeCall(market.multicall, (calls)));
        reentryBlocked = !success && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
        return this.onERC721Received.selector;
    }
}
