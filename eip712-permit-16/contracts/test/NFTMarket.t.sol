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

    function assertUnchanged() internal view {
        assertEq(nft.ownerOf(0), seller);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(market.nonces(buyer), 0);
        (address listedSeller, uint256 price) = market.listings(0);
        assertEq(listedSeller, seller);
        assertEq(price, PRICE);
    }

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
