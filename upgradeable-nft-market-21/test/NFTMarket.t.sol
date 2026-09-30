// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableNFT} from "../src/UpgradeableNFT.sol";
import {MarketToken} from "../src/MarketToken.sol";
import {NFTMarketV1} from "../src/NFTMarketV1.sol";

import {NFTMarketV2} from "../src/NFTMarketV2.sol";

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice 仅用于证明 NFT 本身可以升级，不引入生产业务或新存储。
contract NFTUpgradeProbe is UpgradeableNFT {
    /// @notice 用不同版本号证明代理已切换到新实现。
    function version() external pure override returns (uint256) {
        return 2;
    }
}

/// @notice 模拟拒收或重入的买家；回调中的错误必须被重入锁拦截。
contract BuyerProbe is IERC721Receiver {
    NFTMarketV1 private market;
    bool private reject;

    /// @notice 配置测试市场和是否拒绝 NFT；仅为测试使用。
    constructor(NFTMarketV1 market_, bool reject_) {
        market = market_;
        reject = reject_;
    }

    /// @notice 用自身余额购买，授权仅覆盖本次价格。
    function buy(MarketToken token, uint256 price) external {
        token.approve(address(market), price);
        market.buyNFT(1);
    }

    /// @notice 接收第一枚 NFT 时尝试重入购买第二枚；非预期错误或重入成功均使测试失败。
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        require(!reject, "Buyer rejects NFT");
        try market.buyNFT(2) {
            revert("Reentry succeeded");
        } catch (bytes memory reason) {
            require(
                keccak256(reason)
                    == keccak256(abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)),
                "Wrong reentry error"
            );
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice ERC-1271 测试卖家，只承认测试指定的摘要；不模拟真实钱包权限系统。
contract ContractSeller is IERC1271, IERC721Receiver {
    bytes32 private accepted;

    /// @notice 测试中指定钱包认可的摘要，其他订单返回非法签名标志。
    function accept(bytes32 digest) external {
        accepted = digest;
    }

    /// @notice 合约卖家给市场一次集合授权。
    function approve(UpgradeableNFT nft, address market) external {
        nft.setApprovalForAll(market, true);
    }

    /// @notice 返回 ERC-1271 标准魔数，仅匹配摘要有效。
    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return digest == accepted ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    /// @notice 测试钱包允许安全接收 NFT。
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract NFTMarketTest is Test {
    uint256 internal constant PRICE = 100 ether;
    uint256 internal constant SELLER_KEY = 0xA11CE;
    address internal seller;
    address internal buyer;
    MarketToken internal token;
    UpgradeableNFT internal nft;
    NFTMarketV1 internal market;

    /// @notice 部署原子初始化的 NFT 和市场代理，准备虚拟卖家 NFT 与买家余额。
    function setUp() public {
        seller = vm.addr(SELLER_KEY);
        buyer = makeAddr("buyer");
        token = new MarketToken();
        nft = UpgradeableNFT(
            address(
                new ERC1967Proxy(
                    address(new UpgradeableNFT()),
                    abi.encodeCall(
                        UpgradeableNFT.initialize, (address(this), "Upgradeable NFT", "UNFT", "ipfs://collection/")
                    )
                )
            )
        );
        market = NFTMarketV1(
            address(
                new ERC1967Proxy(
                    address(new NFTMarketV1()),
                    abi.encodeCall(NFTMarketV1.initialize, (address(token), address(nft), address(this)))
                )
            )
        );
        nft.mint(seller, 1);
        nft.mint(seller, 2);
        token.transfer(buyer, 1_000 ether);
        vm.prank(buyer);
        token.approve(address(market), type(uint256).max);
    }

    /// @notice V1 普通购买必须同时结算精确代币金额、转移 NFT 并删除挂单。
    function testV1BuySettlesAndClearsListing() public {
        _list(1);
        vm.prank(buyer);
        market.buyNFT(1);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), 900 ether);
        assertEq(token.balanceOf(address(market)), 0);
        (address listedSeller, uint256 price) = market.listings(1);
        assertEq(listedSeller, address(0));
        assertEq(price, 0);
    }

    /// @notice 升级保留管理员、资产地址、挂单、余额、NFT 和集合授权；旧挂单仍可成交。
    function testUpgradePreservesStateAndV1ListingRemainsBuyable() public {
        _list(1);
        _list(2);
        token.transfer(address(market), 7 ether);
        vm.prank(seller);
        nft.approve(buyer, 2);
        NFTMarketV2 upgraded = _upgrade();
        assertEq(upgraded.version(), 2);
        assertEq(upgraded.owner(), address(this));
        assertEq(address(upgraded.paymentToken()), address(token));
        assertEq(address(upgraded.nft()), address(nft));
        for (uint256 id = 1; id <= 2; ++id) {
            (address storedSeller, uint256 price) = upgraded.listings(id);
            assertEq(storedSeller, seller);
            assertEq(price, PRICE);
            assertEq(nft.ownerOf(id), seller);
        }
        assertEq(token.balanceOf(address(market)), 7 ether);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.allowance(buyer, address(market)), type(uint256).max);
        assertEq(nft.getApproved(2), buyer);
        assertTrue(nft.isApprovedForAll(seller, address(market)));
        vm.prank(buyer);
        upgraded.buyNFT(1);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(upgraded.nonces(seller, 1), 1);
    }

    /// @notice 卖家仅集合授权一次，两枚 NFT 均无需链上 list 即可用签名成交。
    function testSignedListingsUseOneApprovalForTwoNFTs() public {
        NFTMarketV2 upgraded = _upgrade();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        for (uint256 id = 1; id <= 2; ++id) {
            NFTMarketV2.SignedListing memory order = _order(upgraded, id);
            bytes memory signature = _sign(upgraded, order);
            (address listedSeller,) = upgraded.listings(id);
            assertEq(listedSeller, address(0));
            vm.prank(buyer);
            upgraded.buyWithSignature(order, signature);
            assertEq(nft.ownerOf(id), buyer);
            assertEq(upgraded.nonces(seller, id), 1);
        }
        assertEq(token.balanceOf(seller), 2 * PRICE);
        assertTrue(nft.isApprovedForAll(seller, address(market)));
    }

    /// @notice V1 与升级后的 V2 均保留支付币回调购买，成交后市场无残余代币。
    function testCallbackPurchaseBeforeAndAfterUpgrade() public {
        _list(1);
        vm.prank(buyer);
        token.transferWithCallback(address(market), PRICE, abi.encode(uint256(1)));
        NFTMarketV2 upgraded = _upgrade();
        _list(2);
        vm.prank(buyer);
        token.transferWithCallback(address(market), PRICE, abi.encode(uint256(2)));
        assertEq(nft.ownerOf(1), buyer);
        assertEq(nft.ownerOf(2), buyer);
        assertEq(token.balanceOf(seller), 2 * PRICE);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(upgraded.nonces(seller, 2), 2);
    }

    /// @notice 非支付币伪造回调、错误金额和畸形 data 均失败且恢复资金及挂单。
    function testCallbackRejectsForgeryWrongAmountAndData() public {
        _list(1);
        vm.expectRevert("Only payment token");
        market.tokensReceived(buyer, PRICE, abi.encode(uint256(1)));
        vm.startPrank(buyer);
        vm.expectRevert("Incorrect payment");
        token.transferWithCallback(address(market), PRICE + 1, abi.encode(uint256(1)));
        vm.expectRevert("Incorrect payment");
        token.transferWithCallback(address(market), PRICE - 1, abi.encode(uint256(1)));
        vm.expectRevert("Invalid callback data");
        token.transferWithCallback(address(market), PRICE, hex"01");
        vm.stopPrank();
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(address(market)), 0);
        (address storedSeller, uint256 price) = market.listings(1);
        assertEq(storedSeller, seller);
        assertEq(price, PRICE);
    }

    /// @notice 非持有人、零价格和未授权 NFT 都不能上架；只授权单枚时仍支持 V1 上架。
    function testListingValidationAndSingleApproval() public {
        vm.expectRevert("Not NFT owner");
        market.list(1, PRICE);
        vm.startPrank(seller);
        vm.expectRevert("Zero price");
        market.list(1, 0);
        vm.expectRevert("Market not approved");
        market.list(1, PRICE);
        nft.approve(address(market), 1);
        market.list(1, PRICE);
        market.list(1, PRICE + 1);
        vm.stopPrank();
        (, uint256 price) = market.listings(1);
        assertEq(price, PRICE + 1);
    }

    /// @notice 撤销授权或转出 NFT 会阻止旧挂单成交，且买家余额不减少。
    function testStaleOwnershipAndRevokedApprovalRevert() public {
        _list(1);
        vm.prank(seller);
        nft.setApprovalForAll(address(market), false);
        vm.prank(buyer);
        vm.expectRevert("Market not approved");
        market.buyNFT(1);
        vm.prank(seller);
        nft.transferFrom(seller, address(0xBEEF), 1);
        vm.prank(buyer);
        vm.expectRevert("Not NFT owner");
        market.buyNFT(1);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        (address storedSeller,) = market.listings(1);
        assertEq(storedSeller, seller);
    }

    /// @notice 只有挂单卖家能取消，不允许自购或购买不存在的挂单。
    function testCancelAndInvalidBuyer() public {
        _list(1);
        vm.expectRevert("Not seller");
        market.cancelListing(1);
        vm.prank(seller);
        vm.expectRevert("Invalid buyer");
        market.buyNFT(1);
        vm.prank(seller);
        market.cancelListing(1);
        vm.expectRevert("Not listed");
        market.buyNFT(1);
    }

    /// @notice 随机正价格保持精确结算，验证 uint256 金额路径没有缩窄。
    function testFuzzV1ExactPayment(uint256 price) public {
        price = bound(price, 1, type(uint256).max);
        deal(address(token), buyer, price);
        vm.startPrank(seller);
        nft.approve(address(market), 1);
        market.list(1, price);
        vm.stopPrank();
        vm.prank(buyer);
        market.buyNFT(1);
        assertEq(token.balanceOf(seller), price);
        assertEq(token.balanceOf(buyer), 0);
    }

    /// @notice NFT 升级保留管理员、名称、URI、余额、所有权、单枚授权和集合授权，并可继续铸造。
    function testNFTUpgradePreservesState() public {
        vm.startPrank(seller);
        nft.approve(buyer, 1);
        nft.setApprovalForAll(address(market), true);
        vm.stopPrank();
        NFTUpgradeProbe implementation = new NFTUpgradeProbe();
        nft.upgradeToAndCall(address(implementation), "");
        assertEq(nft.version(), 2);
        assertEq(nft.owner(), address(this));
        assertEq(nft.name(), "Upgradeable NFT");
        assertEq(nft.symbol(), "UNFT");
        assertEq(nft.tokenURI(1), "ipfs://collection/1");
        assertEq(nft.balanceOf(seller), 2);
        assertEq(nft.ownerOf(1), seller);
        assertEq(nft.getApproved(1), buyer);
        assertTrue(nft.isApprovedForAll(seller, address(market)));
        nft.mint(seller, 3);
        assertEq(nft.balanceOf(seller), 3);
    }

    /// @notice 非管理员不能升级任何代理或铸造 NFT，失败后版本仍为 V1。
    function testOnlyOwnerCanUpgradeOrMint() public {
        NFTMarketV2 nextMarket = new NFTMarketV2();
        NFTUpgradeProbe nextNFT = new NFTUpgradeProbe();
        bytes memory denied = abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, buyer);
        vm.startPrank(buyer);
        vm.expectRevert(denied);
        market.upgradeToAndCall(address(nextMarket), abi.encodeCall(NFTMarketV2.initializeV2, ()));
        vm.expectRevert(denied);
        nft.upgradeToAndCall(address(nextNFT), "");
        vm.expectRevert(denied);
        nft.mint(buyer, 3);
        vm.stopPrank();
        assertEq(market.version(), 1);
        assertEq(nft.version(), 1);
    }

    /// @notice 实现合约锁定，代理不能重复初始化，V2 初始化只能由管理员执行一次。
    function testInitializationLocks() public {
        UpgradeableNFT nftImpl = new UpgradeableNFT();
        NFTMarketV1 marketImpl = new NFTMarketV1();
        NFTMarketV2 v2Impl = new NFTMarketV2();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        nftImpl.initialize(buyer, "Bad", "BAD", "");
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        marketImpl.initialize(address(token), address(nft), buyer);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        v2Impl.initializeV2();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        nft.initialize(buyer, "Bad", "BAD", "");
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        market.initialize(address(token), address(nft), buyer);
        market.upgradeToAndCall(address(v2Impl), "");
        NFTMarketV2 upgraded = NFTMarketV2(address(market));
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, buyer));
        upgraded.initializeV2();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        vm.expectRevert("V2 not initialized");
        upgraded.orderDigest(order);
        upgraded.initializeV2();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        upgraded.initializeV2();
    }

    /// @notice 初始化拒绝无代码资产与零管理员，UUPS 拒绝不兼容实现并保留旧状态。
    function testInvalidInitializationAndUpgradeRollback() public {
        NFTMarketV1 impl = new NFTMarketV1();
        vm.expectRevert("Invalid asset");
        new ERC1967Proxy(
            address(impl), abi.encodeCall(NFTMarketV1.initialize, (address(0), address(nft), address(this)))
        );
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableInvalidOwner.selector, address(0)));
        new ERC1967Proxy(
            address(impl), abi.encodeCall(NFTMarketV1.initialize, (address(token), address(nft), address(0)))
        );
        _list(1);
        vm.expectRevert();
        market.upgradeToAndCall(address(token), "");
        assertEq(market.version(), 1);
        (address storedSeller, uint256 price) = market.listings(1);
        assertEq(storedSeller, seller);
        assertEq(price, PRICE);
    }

    /// @notice 已成交的签名不能重放，即使买家把 NFT 退回原卖家。
    function testSignatureReplayRejectedAfterNFTReturns() public {
        NFTMarketV2 upgraded = _upgrade();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        vm.prank(buyer);
        upgraded.buyWithSignature(order, signature);
        vm.prank(buyer);
        nft.transferFrom(buyer, seller, 1);
        vm.prank(buyer);
        vm.expectRevert("Invalid nonce");
        upgraded.buyWithSignature(order, signature);
        assertEq(nft.ownerOf(1), seller);
        assertEq(token.balanceOf(seller), PRICE);
    }

    /// @notice 改价格、编号、卖家或截止时间均破坏签名；改 nonce 直接被计数器拒绝。
    function testSignedFieldsCannotBeTampered() public {
        NFTMarketV2 upgraded = _upgrade();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        order.price++;
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, signature);
        order.price--;
        order.tokenId = 2;
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, signature);
        order.tokenId = 1;
        order.seller = buyer;
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, signature);
        order.seller = seller;
        order.deadline++;
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, signature);
        order.deadline--;
        order.nonce++;
        vm.expectRevert("Invalid nonce");
        upgraded.buyWithSignature(order, signature);
        order.nonce--;
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, hex"1234");
    }

    /// @notice 独立编码 EIP-712 摘要，与合约结果对比，避免测试签名和合约同时写错。
    function testDigestMatchesIndependentEIP712Encoding() public {
        NFTMarketV2 upgraded = _upgrade();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("UpgradeableNFTMarket"),
                keccak256("2"),
                block.chainid,
                address(market)
            )
        );
        bytes32 body = keccak256(
            abi.encode(
                keccak256("SignedListing(address seller,uint256 tokenId,uint256 price,uint256 nonce,uint256 deadline)"),
                seller,
                uint256(1),
                PRICE,
                uint256(0),
                order.deadline
            )
        );
        assertEq(upgraded.orderDigest(order), keccak256(abi.encodePacked(hex"1901", domain, body)));
    }

    /// @notice 相同资产的另一个代理或另一条链都不能复用原订单签名。
    function testSignatureCannotCrossProxyOrChain() public {
        NFTMarketV2 upgraded = _upgrade();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        NFTMarketV2 other = NFTMarketV2(
            address(
                new ERC1967Proxy(
                    address(new NFTMarketV2()),
                    abi.encodeCall(NFTMarketV1.initialize, (address(token), address(nft), address(this)))
                )
            )
        );
        other.initializeV2();
        vm.expectRevert("Invalid signature");
        other.buyWithSignature(order, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert("Invalid signature");
        upgraded.buyWithSignature(order, signature);
    }

    /// @notice 到期前可报价，过期一秒必须拒绝且不消耗 nonce。
    function testExpiredSignatureRejected() public {
        NFTMarketV2 upgraded = _upgrade();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        vm.warp(order.deadline + 1);
        vm.expectRevert("Order expired");
        upgraded.buyWithSignature(order, signature);
        assertEq(upgraded.nonces(seller, 1), 0);
    }

    /// @notice 主动取消、重新上架、取消链上挂单和普通成交都使旧签名失效。
    function testAllOrderInvalidationPaths() public {
        NFTMarketV2 upgraded = _upgrade();
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        vm.prank(seller);
        upgraded.cancelSignedListing(1);
        vm.expectRevert("Invalid nonce");
        upgraded.buyWithSignature(order, signature);
        vm.prank(seller);
        upgraded.list(1, PRICE);
        assertEq(upgraded.nonces(seller, 1), 2);
        vm.prank(seller);
        upgraded.cancelListing(1);
        assertEq(upgraded.nonces(seller, 1), 3);
        vm.prank(seller);
        upgraded.list(1, PRICE);
        order = _order(upgraded, 1);
        signature = _sign(upgraded, order);
        vm.prank(buyer);
        upgraded.buyNFT(1);
        assertEq(upgraded.nonces(seller, 1), 5);
        vm.expectRevert("Invalid nonce");
        upgraded.buyWithSignature(order, signature);
    }

    /// @notice 签名成交扣款失败时，nonce 与原链上挂单保持不变；补回授权即可成交。
    function testSignedPaymentFailureRollsBackNonceAndListing() public {
        NFTMarketV2 upgraded = _upgrade();
        _list(1);
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        vm.prank(buyer);
        token.approve(address(market), 0);
        vm.prank(buyer);
        vm.expectRevert();
        upgraded.buyWithSignature(order, signature);
        assertEq(upgraded.nonces(seller, 1), order.nonce);
        (address storedSeller, uint256 price) = upgraded.listings(1);
        assertEq(storedSeller, seller);
        assertEq(price, PRICE);
        assertEq(nft.ownerOf(1), seller);
        assertEq(token.balanceOf(seller), 0);
        vm.prank(buyer);
        token.approve(address(market), PRICE);
        vm.prank(buyer);
        upgraded.buyWithSignature(order, signature);
        (storedSeller, price) = upgraded.listings(1);
        assertEq(storedSeller, address(0));
        assertEq(price, 0);
    }

    /// @notice 有效签名也不能绕过实时所有权、授权和非零价格校验。
    function testSignedSettlementValidatesAssetsAndPrice() public {
        NFTMarketV2 upgraded = _upgrade();
        NFTMarketV2.SignedListing memory order = _order(upgraded, 1);
        bytes memory signature = _sign(upgraded, order);
        vm.prank(buyer);
        vm.expectRevert("Market not approved");
        upgraded.buyWithSignature(order, signature);
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        order.price = 0;
        signature = _sign(upgraded, order);
        vm.prank(buyer);
        vm.expectRevert("Zero price");
        upgraded.buyWithSignature(order, signature);
        order.price = PRICE;
        signature = _sign(upgraded, order);
        vm.prank(seller);
        nft.transferFrom(seller, buyer, 1);
        vm.prank(buyer);
        vm.expectRevert("Not NFT owner");
        upgraded.buyWithSignature(order, signature);
        assertEq(upgraded.nonces(seller, 1), 0);
    }

    /// @notice 合约钱包卖家使用 ERC-1271 验证摘要并收到价款。
    function testERC1271SellerCanSign() public {
        NFTMarketV2 upgraded = _upgrade();
        ContractSeller wallet = new ContractSeller();
        nft.mint(address(wallet), 3);
        wallet.approve(nft, address(market));
        NFTMarketV2.SignedListing memory order =
            NFTMarketV2.SignedListing(address(wallet), 3, PRICE, 0, block.timestamp);
        wallet.accept(upgraded.orderDigest(order));
        vm.prank(buyer);
        upgraded.buyWithSignature(order, hex"1234");
        assertEq(nft.ownerOf(3), buyer);
        assertEq(token.balanceOf(address(wallet)), PRICE);
    }

    /// @notice 买家拒收 NFT 时，之前转出的代币、挂单和所有权全部回滚。
    function testRejectingReceiverRollsBackPayment() public {
        _list(1);
        BuyerProbe rejecting = new BuyerProbe(market, true);
        token.transfer(address(rejecting), PRICE);
        vm.expectRevert("Buyer rejects NFT");
        rejecting.buy(token, PRICE);
        assertEq(token.balanceOf(address(rejecting)), PRICE);
        assertEq(token.balanceOf(seller), 0);
        assertEq(nft.ownerOf(1), seller);
        (address storedSeller,) = market.listings(1);
        assertEq(storedSeller, seller);
    }

    /// @notice 接收 NFT 的回调不能重入另一个挂单，第一笔交易仍正常完成。
    function testReceiverCannotReenterAnotherListing() public {
        _list(1);
        _list(2);
        BuyerProbe probe = new BuyerProbe(market, false);
        token.transfer(address(probe), 2 * PRICE);
        probe.buy(token, PRICE);
        assertEq(nft.ownerOf(1), address(probe));
        assertEq(nft.ownerOf(2), seller);
        assertEq(token.balanceOf(seller), PRICE);
    }

    /// @notice 通过管理员在同一交易内升级并初始化 V2，代理地址保持不变。
    function _upgrade() internal returns (NFTMarketV2 upgraded) {
        market.upgradeToAndCall(address(new NFTMarketV2()), abi.encodeCall(NFTMarketV2.initializeV2, ()));
        upgraded = NFTMarketV2(address(market));
    }

    /// @notice 从当前 nonce 构建一小时内有效的测试订单，金额使用最小单位。
    function _order(NFTMarketV2 upgraded, uint256 id) internal view returns (NFTMarketV2.SignedListing memory) {
        return NFTMarketV2.SignedListing(seller, id, PRICE, upgraded.nonces(seller, id), block.timestamp + 1 hours);
    }

    /// @notice 仅用虚拟测试密钥签署代理计算的 EIP-712 摘要，不读取任何真实钱包。
    function _sign(NFTMarketV2 upgraded, NFTMarketV2.SignedListing memory order) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SELLER_KEY, upgraded.orderDigest(order));
        return abi.encodePacked(r, s, v);
    }

    /// @notice 用同一次集合授权上架指定 NFT；后续升级必须保留此授权。
    function _list(uint256 tokenId) internal {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(market), true);
        market.list(tokenId, PRICE);
        vm.stopPrank();
    }
}
