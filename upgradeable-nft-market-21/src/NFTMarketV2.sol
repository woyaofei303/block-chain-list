// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {NFTMarketV1} from "./NFTMarketV1.sol";

/// @notice V2：保留 V1 交易入口，新增卖家零 Gas 签名挂单、买家携签名直接成交。
contract NFTMarketV2 is NFTMarketV1, EIP712Upgradeable {
    struct SignedListing {
        address seller;
        uint256 tokenId;
        uint256 price;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant LISTING_TYPEHASH =
        keccak256("SignedListing(address seller,uint256 tokenId,uint256 price,uint256 nonce,uint256 deadline)");

    // 只在 V1 尾部追加。每个卖家、每枚 NFT 独立 nonce，一次集合授权可支持多份订单。
    mapping(address seller => mapping(uint256 tokenId => uint256)) public nonces;
    event SignedListingCancelled(address indexed seller, uint256 indexed tokenId, uint256 newNonce);

    /// @notice 升级时由管理员通过 upgradeToAndCall 原子初始化 EIP-712 域，仅可执行一次。
    function initializeV2() external reinitializer(2) onlyOwner {
        __EIP712_init("UpgradeableNFTMarket", "2");
    }

    /// @notice 返回实际签名摘要；域绑定当前 chainId 和市场代理，禁止未初始化的签名域。
    function orderDigest(SignedListing calldata order) public view returns (bytes32) {
        require(_getInitializedVersion() >= 2, "V2 not initialized");
        return _hashTypedDataV4(
            keccak256(
                abi.encode(LISTING_TYPEHASH, order.seller, order.tokenId, order.price, order.nonce, order.deadline)
            )
        );
    }

    /// @notice 买家提交卖家离线签名并支付 ERC20；支持 EOA / ERC-1271，失败不消耗 nonce。
    /// @dev 卖家只需事先对代理 setApprovalForAll；无需逐枚发送上架交易。订单向所有买家开放。
    function buyWithSignature(SignedListing calldata order, bytes calldata signature) external nonReentrant {
        require(block.timestamp <= order.deadline, "Order expired");
        require(order.nonce == nonces[order.seller][order.tokenId], "Invalid nonce");
        require(SignatureChecker.isValidSignatureNow(order.seller, orderDigest(order), signature), "Invalid signature");
        // 在支付和 NFT 接收回调前消耗订单、清除链上旧报价；结算失败时全部回滚。
        ++nonces[order.seller][order.tokenId];
        delete listings[order.tokenId];
        _settle(order.seller, msg.sender, order.tokenId, order.price, false);
    }

    /// @notice 卖家递增指定 NFT 的 nonce，取消该编号所有尚未成交的当前签名报价。
    function cancelSignedListing(uint256 tokenId) external {
        uint256 newNonce = ++nonces[msg.sender][tokenId];
        emit SignedListingCancelled(msg.sender, tokenId, newNonce);
    }

    /// @notice 重新链上上架同时作废该卖家该 NFT 的旧签名，避免新旧报价竞争。
    function list(uint256 tokenId, uint256 price) public override {
        super.list(tokenId, price);
        ++nonces[msg.sender][tokenId];
    }

    /// @notice 取消链上挂单时同时作废对应签名；没有链上挂单时用 cancelSignedListing。
    function cancelListing(uint256 tokenId) public override {
        super.cancelListing(tokenId);
        ++nonces[msg.sender][tokenId];
    }

    /// @notice 返回 V2 版本；调用地址仍为原市场代理。
    function version() external pure override returns (uint256) {
        return 2;
    }

    /// @notice V1 两种成交入口也作废卖家的旧签名，防止 NFT 回到原持有人后被重复买走。
    function _takeListing(uint256 tokenId) internal override returns (Listing memory listing) {
        listing = super._takeListing(tokenId);
        ++nonces[listing.seller][tokenId];
    }
}
