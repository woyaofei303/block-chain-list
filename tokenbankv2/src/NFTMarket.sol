// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITokenReceiverWithData} from "./ERC20WithCallback.sol";

interface IERC20MarketToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721MarketNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

contract NFTMarket is ITokenReceiverWithData {
    struct Listing {
        address seller;
        uint256 price;
    }

    IERC20MarketToken public immutable paymentToken;
    IERC721MarketNFT public immutable nft;
    mapping(uint256 tokenId => Listing) public listings;

    constructor(address paymentTokenAddress, address nftAddress) {
        require(paymentTokenAddress.code.length > 0, "Invalid payment token");
        require(nftAddress.code.length > 0, "Invalid NFT");
        paymentToken = IERC20MarketToken(paymentTokenAddress);
        nft = IERC721MarketNFT(nftAddress);
    }

    function list(uint256 tokenId, uint256 price) external {
        require(nft.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(price > 0, "Price must be positive");
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "Market not approved"
        );
        listings[tokenId] = Listing({seller: msg.sender, price: price});
    }

    function buyNFT(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");

        delete listings[tokenId];
        require(paymentToken.transferFrom(msg.sender, listing.seller, listing.price), "Token transfer failed");
        nft.transferFrom(listing.seller, msg.sender, tokenId);
    }

    function tokensReceived(address from, uint256 amount, bytes calldata data) external returns (bool) {
        require(msg.sender == address(paymentToken), "Only payment token");
        require(data.length == 32, "Invalid callback data");
        uint256 tokenId = abi.decode(data, (uint256));
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");
        require(amount == listing.price, "Incorrect payment amount");

        delete listings[tokenId];
        require(paymentToken.transfer(listing.seller, listing.price), "Token transfer failed");
        nft.transferFrom(listing.seller, from, tokenId);
        return true;
    }
}
