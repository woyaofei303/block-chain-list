// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ITokenReceiver} from "./MarketToken.sol";

/// @notice V1：指定 ERC721 集合的 ERC20 定价市场，支持授权购买和转账回调购买。
/// @dev OZ 5.7 的 ReentrancyGuard 使用独立命名空间；代理初始状态 0 可进入，退出时归一为 1。
contract NFTMarketV1 is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuard, ITokenReceiver {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        uint256 price;
    }

    // V2 必须保留这三个字段的类型与顺序；NFT 始终留在卖家钱包，成交时才转移。
    IERC20 public paymentToken;
    IERC721 public nft;
    mapping(uint256 tokenId => Listing) public listings;

    event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price);
    event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price);
    event ListingCancelled(address indexed seller, uint256 indexed tokenId);

    /// @notice 禁止直接初始化实现合约，防止实现被接管。
    constructor() {
        _disableInitializers();
    }

    /// @notice 仅初始化一次，绑定有代码的支付币、NFT 及非零管理员；部署时须与代理创建原子执行。
    function initialize(address token_, address nft_, address admin) external initializer {
        require(token_.code.length > 0 && nft_.code.length > 0, "Invalid asset");
        __Ownable_init(admin);
        paymentToken = IERC20(token_);
        nft = IERC721(nft_);
    }

    /// @notice 持有人授权后以最小代币单位上架；重复上架覆盖价格。
    function list(uint256 tokenId, uint256 price) public virtual nonReentrant {
        _validateListing(msg.sender, tokenId, price);
        listings[tokenId] = Listing(msg.sender, price);
        emit NFTListed(msg.sender, tokenId, price);
    }

    /// @notice 仅挂单卖家可取消；即使已转出 NFT，仍可清理自己的旧挂单。
    function cancelListing(uint256 tokenId) public virtual nonReentrant {
        require(listings[tokenId].seller == msg.sender, "Not seller");
        delete listings[tokenId];
        emit ListingCancelled(msg.sender, tokenId);
    }

    /// @notice 买家先授权支付币，再购买链上挂单；任何结算失败都恢复挂单。
    function buyNFT(uint256 tokenId) external nonReentrant {
        Listing memory listing = _takeListing(tokenId);
        _settle(listing.seller, msg.sender, tokenId, listing.price, false);
    }

    /// @notice 仅指定支付币可回调；付款必须恰好等于报价，data 必须为 abi.encode(tokenId)。
    function tokensReceived(address from, uint256 amount, bytes calldata data) external nonReentrant returns (bool) {
        require(msg.sender == address(paymentToken), "Only payment token");
        require(data.length == 32, "Invalid callback data");
        uint256 tokenId = abi.decode(data, (uint256));
        Listing memory listing = _takeListing(tokenId);
        require(amount == listing.price, "Incorrect payment");
        _settle(listing.seller, from, tokenId, listing.price, true);
        return true;
    }

    /// @notice 通过代理读取实现版本；V2 覆盖此返回值。
    function version() external pure virtual returns (uint256) {
        return 1;
    }

    /// @notice 共用上架校验：正价格、当前持有人，以及单枚或集合授权。
    function _validateListing(address seller, uint256 tokenId, uint256 price) internal view {
        require(price > 0, "Zero price");
        require(nft.ownerOf(tokenId) == seller, "Not NFT owner");
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(seller, address(this)),
            "Market not approved"
        );
    }

    /// @notice 先清空已存在的挂单再进行外部结算；失败时 EVM 自动恢复。
    function _takeListing(uint256 tokenId) internal virtual returns (Listing memory listing) {
        listing = listings[tokenId];
        require(listing.seller != address(0), "Not listed");
        delete listings[tokenId];
    }

    /// @notice 结算入口；prepaid 区分已由回调收到的代币和需要向买家扣除的代币。
    function _settle(address seller, address buyer, uint256 tokenId, uint256 price, bool prepaid) internal {
        require(buyer != seller && buyer != address(0), "Invalid buyer");
        _validateListing(seller, tokenId, price);
        // 调用方已删除挂单并锁住重入；任一资产转移失败会回滚整笔交易。
        if (prepaid) paymentToken.safeTransfer(seller, price);
        else paymentToken.safeTransferFrom(buyer, seller, price);
        nft.safeTransferFrom(seller, buyer, tokenId);
        emit NFTSold(seller, buyer, tokenId, price);
    }

    /// @notice 仅管理员可切换实现地址，UUPS 继续检查 ERC-1822 兼容性。
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
