// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20WithCallback} from "../src/ERC20WithCallback.sol";
import {NFTMarket} from "../src/NFTMarket.sol";

contract MarketTestNFT is ERC721 {
    constructor() ERC721("Market Test NFT", "MTNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract NFTMarketTest is Test {
    event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price);
    event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price);

    uint256 private constant TOKEN_ID = 7;
    uint256 private constant PRICE = 100 ether;

    ERC20WithCallback private token;
    MarketTestNFT private nft;
    NFTMarket private market;
    address private seller;
    address private buyer;

    function setUp() public {
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        token = new ERC20WithCallback();
        nft = new MarketTestNFT();
        market = new NFTMarket(address(token), address(nft));

        token.transfer(buyer, 1_000 ether);
        nft.mint(seller, TOKEN_ID);
    }

    function testBuyerCanPurchaseListedNFT() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        (address listedSeller, uint256 listedPrice) = market.listings(TOKEN_ID);
        assertEq(listedSeller, seller);
        assertEq(listedPrice, PRICE);

        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        market.buyNFT(TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), 900 ether);
        (listedSeller, listedPrice) = market.listings(TOKEN_ID);
        assertEq(listedSeller, address(0));
        assertEq(listedPrice, 0);
    }

    function testListEmitsNFTListed() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);

        vm.expectEmit(true, true, false, true, address(market));
        emit NFTListed(seller, TOKEN_ID, PRICE);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();
    }

    function testBuyNFTEmitsNFTSold() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        vm.expectEmit(true, true, true, true, address(market));
        emit NFTSold(seller, buyer, TOKEN_ID, PRICE);
        market.buyNFT(TOKEN_ID);
        vm.stopPrank();
    }

    function testNonOwnerCannotListNFT() public {
        vm.prank(buyer);
        vm.expectRevert("Only NFT owner");
        market.list(TOKEN_ID, PRICE);
    }

    function testCannotListNFTForZeroPrice() public {
        vm.prank(seller);
        vm.expectRevert("Price must be positive");
        market.list(TOKEN_ID, 0);
    }

    function testListingRequiresMarketApproval() public {
        vm.prank(seller);
        vm.expectRevert("Market not approved");
        market.list(TOKEN_ID, PRICE);
    }

    function testBuyerCanPurchaseWithTokenCallbackData() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectEmit(true, true, true, true, address(market));
        emit NFTSold(seller, buyer, TOKEN_ID, PRICE);
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), 900 ether);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function testForgedTokenCallbackIsRejected() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert("Only payment token");
        market.tokensReceived(buyer, PRICE, abi.encode(TOKEN_ID));
    }

    function testCallbackPurchaseRequiresExactPrice() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert("Incorrect payment amount");
        token.transferWithCallback(address(market), PRICE - 1, abi.encode(TOKEN_ID));

        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    function testCallbackPurchaseRejectsMalformedData() public {
        vm.prank(buyer);
        vm.expectRevert("Invalid callback data");
        token.transferWithCallback(address(market), PRICE, hex"01");

        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function testConstructorRejectsInvalidContracts() public {
        vm.expectRevert("Invalid payment token");
        new NFTMarket(address(0), address(nft));

        vm.expectRevert("Invalid NFT");
        new NFTMarket(address(token), address(0));
    }
}
