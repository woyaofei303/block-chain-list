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

/// @notice 使用指定 ERC20 买卖指定 ERC721 集合的固定价格市场。
/// @dev 完整闭环：卖家授权并上架 → 写入挂单并发出 NFTListed → 买家通过 buyNFT 或 Token 回调付款
///      → 清除挂单、结算 ERC20、转移 NFT 并发出 NFTSold → 链下监听器读取事件并打印交易记录。
///      结算中的任一步失败都会回滚挂单、Token、NFT 和事件，链上不会留下半完成状态。
contract NFTMarket is ITokenReceiverWithData {
    struct Listing {
        address seller;
        uint256 price;
    }

    IERC20MarketToken public immutable paymentToken;
    IERC721MarketNFT public immutable nft;
    // 每个 tokenId 最多保存一条挂单；seller 为零地址表示未上架。
    mapping(uint256 tokenId => Listing) public listings;

    /// @notice NFT 上架成功后发出，供链下服务记录卖家和报价。
    event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price);

    /// @notice NFT 成交后发出；普通购买和 Token 回调购买共用此事件。
    event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price);

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
        emit NFTListed(msg.sender, tokenId, price);
    }

    function buyNFT(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");

        // 先清除挂单，阻止外部转账期间重复购买；后续失败时整笔交易会自动回滚。
        delete listings[tokenId];
        emit NFTSold(listing.seller, msg.sender, tokenId, listing.price);
        require(paymentToken.transferFrom(msg.sender, listing.seller, listing.price), "Token transfer failed");
        nft.transferFrom(listing.seller, msg.sender, tokenId);
    }

    function tokensReceived(address from, uint256 amount, bytes calldata data) external returns (bool) {
        // 只接受绑定的支付 Token 回调，防止伪造付款通知。
        require(msg.sender == address(paymentToken), "Only payment token");
        require(data.length == 32, "Invalid callback data");
        // transferWithCallback 的 data 约定编码为 abi.encode(tokenId)。
        uint256 tokenId = abi.decode(data, (uint256));
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");
        require(amount == listing.price, "Incorrect payment amount");

        // Token 已由回调转入市场，此处转给卖家并把 NFT 交给原付款人 from。
        delete listings[tokenId];
        emit NFTSold(listing.seller, from, tokenId, listing.price);
        require(paymentToken.transfer(listing.seller, listing.price), "Token transfer failed");
        nft.transferFrom(listing.seller, from, tokenId);
        return true;
    }
}
