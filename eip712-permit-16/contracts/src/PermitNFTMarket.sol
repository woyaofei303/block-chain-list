// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NFTMarket as BaseNFTMarket} from "./NFTMarket.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice 复用第 08 题的上架与结算，只增加项目方白名单授权。
contract PermitNFTMarket is BaseNFTMarket, EIP712, ReentrancyGuard {
    bytes32 public constant WHITELIST_TYPEHASH = keccak256(
        "Whitelist(address buyer,address seller,uint256 tokenId,uint256 price,uint256 nonce,uint256 deadline)"
    );
    address public immutable whitelistSigner;
    mapping(address => uint256) public nonces;
    event ListingCancelled(uint256 indexed tokenId);

    constructor(address tokenAddress, address nftAddress, address signer)
        BaseNFTMarket(tokenAddress, nftAddress)
        EIP712("Julian NFT Market", "1")
    {
        require(signer != address(0), "Invalid signer");
        whitelistSigner = signer;
    }

    function list(uint256 tokenId, uint256 price) public override nonReentrant {
        super.list(tokenId, price);
    }

    function cancel(uint256 tokenId) external nonReentrant {
        require(listings[tokenId].seller == msg.sender, "Only seller");
        delete listings[tokenId];
        emit ListingCancelled(tokenId);
    }

    function permitBuy(uint256 tokenId, uint256 deadline, bytes calldata signature) external nonReentrant {
        require(block.timestamp <= deadline, "Whitelist expired");
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");
        require(listing.seller != msg.sender, "Cannot buy own NFT");
        require(nft.ownerOf(tokenId) == listing.seller, "Seller no longer owner");
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    WHITELIST_TYPEHASH, msg.sender, listing.seller, tokenId, listing.price, nonces[msg.sender], deadline
                )
            )
        );
        require(ECDSA.recover(digest, signature) == whitelistSigner, "Not whitelisted");
        nonces[msg.sender]++;
        _buy(tokenId, msg.sender);
    }

    // 所有继承的购买入口必须服从白名单，不能从旧入口绕过校验。
    function buyNFT(uint256) external pure override {
        revert("Whitelist required");
    }

    function tokensReceived(address, uint256, bytes calldata) external pure override returns (bool) {
        revert("Whitelist required");
    }

    function _transferNFT(address seller, address buyer, uint256 tokenId) internal override {
        IERC721(address(nft)).safeTransferFrom(seller, buyer, tokenId);
    }
}
