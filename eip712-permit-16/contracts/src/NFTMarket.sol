// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// 接口沿用第 08 题；此处集中定义，签名市场禁用该回调入口。
interface ITokenReceiverWithData {
    /// @notice 转币后由 Token 通知接收方；from 是原付款人，接收方仍须验证通知来源。
    function tokensReceived(address from, uint256 amount, bytes calldata data) external returns (bool);
}

interface IERC20MarketToken {
    /// @notice 把市场已经收到的 Token 转给卖家，用于回调付款路径。
    function transfer(address to, uint256 amount) external returns (bool);
    /// @notice 按买家授予市场的额度，把 Token 直接从买家转给卖家。
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC721MarketNFT {
    /// @notice 读取 NFT 当前持有人；挂单不等于 NFT 已经托管给市场。
    function ownerOf(uint256 tokenId) external view returns (address);
    /// @notice 读取仅针对这一件 NFT 的转移授权地址。
    function getApproved(uint256 tokenId) external view returns (address);
    /// @notice 查询 owner 是否允许 operator 转移其整个集合中的 NFT。
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    /// @notice 把指定 NFT 从卖家转给买家；调用者必须有持有人授权。
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

    /// @notice 绑定一种支付币和一个 NFT 集合，拒绝把没有代码的钱包地址当成合约。
    constructor(address paymentTokenAddress, address nftAddress) {
        require(paymentTokenAddress.code.length > 0, "Invalid payment token");
        require(nftAddress.code.length > 0, "Invalid NFT");
        paymentToken = IERC20MarketToken(paymentTokenAddress);
        nft = IERC721MarketNFT(nftAddress);
    }

    /// @notice 持有人报价并确认市场有转移权限；此时只保存挂单，NFT 仍在卖家名下。
    function list(uint256 tokenId, uint256 price) public virtual {
        require(nft.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(price > 0, "Price must be positive");
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "Market not approved"
        );
        listings[tokenId] = Listing({seller: msg.sender, price: price});
        emit NFTListed(msg.sender, tokenId, price);
    }

    /// @notice 普通市场的购买入口，使用调用者的授权付款；签名子合约会禁用它。
    function buyNFT(uint256 tokenId) external virtual {
        _buy(tokenId, msg.sender);
    }

    // 普通购买与后续签名授权扩展共用挂单、付款和成交事件。
    function _buy(uint256 tokenId, address buyer) internal {
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");

        // 先清除挂单，阻止外部转账期间重复购买；后续失败时整笔交易会自动回滚。
        delete listings[tokenId];
        emit NFTSold(listing.seller, buyer, tokenId, listing.price);
        require(paymentToken.transferFrom(buyer, listing.seller, listing.price), "Token transfer failed");
        _transferNFT(listing.seller, buyer, tokenId);
    }

    /// @notice 普通市场直接转移 NFT；留出覆盖点，让签名市场改用安全接收回调。
    function _transferNFT(address seller, address buyer, uint256 tokenId) internal virtual {
        nft.transferFrom(seller, buyer, tokenId);
    }

    /// @notice 处理已经转入的付款：只认绑定 Token 的回调，金额与挂单价必须完全一致。
    function tokensReceived(address from, uint256 amount, bytes calldata data) external virtual returns (bool) {
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
