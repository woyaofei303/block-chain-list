// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {JulianToken} from "../src/JulianToken.sol";
import {BlocklightGenesis} from "../src/BlocklightGenesis.sol";
import {PermitNFTMarket as NFTMarket} from "../src/PermitNFTMarket.sol";

contract NFTMarketTest is Test {
    JulianToken token;
    BlocklightGenesis nft;
    NFTMarket market;
    address seller;
    address buyer;
    address issuer;
    uint256 issuerKey;
    uint256 constant PRICE = 100 ether;
    bytes32 constant TYPEHASH = keccak256(
        "Whitelist(address buyer,address seller,uint256 tokenId,uint256 price,uint256 nonce,uint256 deadline)"
    );

    /// @notice 准备报价 100 JUL 的 NFT #0，分别授予市场 NFT 转移权和买家的付款额度。
    function setUp() public {
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        (issuer, issuerKey) = makeAddrAndKey("project issuer");
        token = new JulianToken();
        nft = new BlocklightGenesis(address(this));
        market = new NFTMarket(address(token), address(nft), issuer);
        token.transfer(buyer, 1_000 ether);
        nft.safeMint(seller, "ipfs://practice/metadata.json");
        vm.startPrank(seller);
        nft.approve(address(market), 0);
        market.list(0, PRICE);
        vm.stopPrank();
        vm.prank(buyer);
        token.approve(address(market), PRICE);
    }

    /// @notice 用项目方的虚拟测试密钥给指定买家签发资格，域中包含当前链与市场地址。
    function signWhitelist(address account, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Julian NFT Market"),
                keccak256("1"),
                block.chainid,
                address(market)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1901", domain, keccak256(abi.encode(TYPEHASH, account, seller, uint256(0), PRICE, nonce, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice 买家付 100 JUL、卖家交付 NFT；市场不留付款，旧挂单清除，买家 nonce 增加一次。
    function testPermitBuyTransfersPaymentAndNFT() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        console2.log("Before: NFT #0 owner", nft.ownerOf(0));
        console2.log("Before: buyer JUL", token.balanceOf(buyer));
        console2.log("Before: seller JUL", token.balanceOf(seller));
        vm.prank(buyer);
        market.permitBuy(0, deadline, signature);
        assertEq(nft.ownerOf(0), buyer);
        assertEq(token.balanceOf(buyer), 900 ether);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(market.nonces(buyer), 1);
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, address(0));
        assertEq(price, 0);
        console2.log("After: NFT #0 owner (buyer)", nft.ownerOf(0));
        console2.log("After: buyer JUL", token.balanceOf(buyer));
        console2.log("After: seller JUL", token.balanceOf(seller));
    }

    /// @notice 失败后同时检查 NFT、双方付款余额、挂单和 nonce，确认没有半笔成交。
    function assertUnchanged() internal view {
        assertEq(nft.ownerOf(0), seller);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(market.nonces(buyer), 0);
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, seller);
        assertEq(price, PRICE);
    }

    /// @notice 换买家、冒充签发人或提交畸形签名都不能买走 NFT，原挂单仍保留。
    function testOtherBuyerWrongIssuerAndMalformedSignatureReject() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(0, deadline, signature);
        (, issuerKey) = makeAddrAndKey("impostor");
        signature = signWhitelist(buyer, 0, deadline);
        vm.startPrank(buyer);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(0, deadline, signature);
        vm.expectRevert();
        market.permitBuy(0, deadline, hex"1234");
        vm.stopPrank();
        assertUnchanged();
    }

    /// @notice 期限、链和市场是签名有效范围；不能把同一资格拿到另一环境复用。
    function testExpiredWrongChainAndWrongMarketReject() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        NFTMarket other = new NFTMarket(address(token), address(nft), issuer);
        vm.startPrank(seller);
        nft.approve(address(other), 0);
        other.list(0, PRICE);
        vm.stopPrank();
        vm.startPrank(buyer);
        vm.expectRevert("Not whitelisted");
        other.permitBuy(0, deadline, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(0, deadline, signature);
        vm.warp(deadline + 1);
        vm.expectRevert("Whitelist expired");
        market.permitBuy(0, deadline, signature);
        vm.stopPrank();
        assertUnchanged();
    }

    /// @notice 签名后改价或换 NFT 编号应失败，买家的资格只针对原始交易条件。
    function testChangedPriceOrTokenIdReject() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        nft.safeMint(seller, "ipfs://practice/metadata.json");
        vm.startPrank(seller);
        nft.approve(address(market), 1);
        market.list(1, PRICE);
        market.list(0, PRICE + 1);
        vm.stopPrank();
        vm.startPrank(buyer);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(0, deadline, signature);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(1, deadline, signature);
        vm.stopPrank();
        assertEq(nft.ownerOf(0), seller);
        assertEq(nft.ownerOf(1), seller);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(market.nonces(buyer), 0);
    }

    /// @notice 成交消耗买家 nonce；同一 NFT 后续再上架时，旧资格签名不能再次使用。
    function testReplayAfterRelistingRejects() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        vm.startPrank(buyer);
        market.permitBuy(0, deadline, signature);
        nft.transferFrom(buyer, seller, 0);
        token.approve(address(market), PRICE);
        vm.stopPrank();
        vm.startPrank(seller);
        nft.approve(address(market), 0);
        market.list(0, PRICE);
        vm.stopPrank();
        vm.prank(buyer);
        vm.expectRevert("Not whitelisted");
        market.permitBuy(0, deadline, signature);
        assertEq(market.nonces(buyer), 1);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(nft.ownerOf(0), seller);
    }

    /// @notice 付款失败或 NFT 无法交付时，前面的 nonce 和挂单修改都必须撤销。
    function testPaymentOrNFTFailureRollsBackNonceListingAndBalances() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = signWhitelist(buyer, 0, deadline);
        vm.startPrank(buyer);
        token.approve(address(market), 0);
        vm.expectRevert();
        market.permitBuy(0, deadline, signature);
        token.approve(address(market), PRICE);
        vm.stopPrank();
        assertUnchanged();
        vm.prank(seller);
        nft.approve(address(0), 0);
        vm.prank(buyer);
        vm.expectRevert();
        market.permitBuy(0, deadline, signature);
        assertUnchanged();
        assertEq(token.allowance(buyer, address(market)), PRICE);
    }

    /// @notice 分别检查铸造、上架和取消由谁执行，持有支付币并不自动取得卖家权限。
    function testListingMintAndCancelPermissions() public {
        vm.startPrank(buyer);
        vm.expectRevert();
        nft.safeMint(buyer, "ipfs://practice/metadata.json");
        vm.expectRevert("Only NFT owner");
        market.list(0, PRICE);
        vm.expectRevert("Only seller");
        market.cancel(0);
        vm.stopPrank();
        vm.startPrank(seller);
        vm.expectRevert("Price must be positive");
        market.list(0, 0);
        market.cancel(0);
        nft.approve(address(0), 0);
        vm.expectRevert("Market not approved");
        market.list(0, PRICE);
        vm.stopPrank();
        vm.prank(buyer);
        vm.expectRevert("NFT not listed");
        market.permitBuy(0, block.timestamp + 1 hours, hex"");
    }

    /// @notice 继承来的普通购买与转账回调都必须拒绝，不能绕过签名购买入口。
    function testInheritedPurchaseEntrypointsCannotBypassWhitelist() public {
        vm.startPrank(buyer);
        vm.expectRevert("Whitelist required");
        market.buyNFT(0);
        vm.expectRevert("Whitelist required");
        market.tokensReceived(buyer, PRICE, abi.encode(uint256(0)));
        vm.stopPrank();
        assertUnchanged();
    }
}
