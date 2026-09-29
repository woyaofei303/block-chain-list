// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev 冻结自提交 d4767afd，仅用于优化前行为与 Gas 对比，不用于部署。
/// @notice 非托管 NFT 挂单市场：白名单买家用 Permit 授权，以五折支付 Token。
/// @dev 保留题面的 Airdop 拼写。继承的 multicall 对 address(this) 逐个 delegatecall，
///      保留原 msg.sender；子调用错误原样冒泡，整笔交易包括 Permit nonce 一起回滚。
contract AirdopMerkleNFTMarketV1 is Multicall, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        uint256 price;
    }

    IERC20 public immutable paymentToken;
    IERC721 public immutable nft;
    bytes32 public immutable merkleRoot;
    mapping(uint256 tokenId => Listing) public listings;

    event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price);
    event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 paid);

    /// @notice 固定本项目 Token、NFT 与白名单根；无合约代码的地址和空根不能部署。
    constructor(address tokenAddress, address nftAddress, bytes32 root) {
        require(tokenAddress.code.length > 0, "Invalid payment token");
        require(nftAddress.code.length > 0, "Invalid NFT");
        require(root != bytes32(0), "Empty root");
        paymentToken = IERC20(tokenAddress);
        nft = IERC721(nftAddress);
        merkleRoot = root;
    }

    /// @notice 持有人先 approve 或 setApprovalForAll，再按最小单位的正数原价上架/改价。
    /// @dev 上架不转移 NFT；成交时仍需有效所有权及授权。重入锁防止接收回调中改写挂单。
    function list(uint256 tokenId, uint256 price) external nonReentrant {
        require(nft.ownerOf(tokenId) == msg.sender, "Only NFT owner");
        require(price > 0, "Price must be positive");
        require(
            nft.getApproved(tokenId) == address(this) || nft.isApprovedForAll(msg.sender, address(this)),
            "Market not approved"
        );
        listings[tokenId] = Listing(msg.sender, price);
        emit NFTListed(msg.sender, tokenId, price);
    }

    /// @notice 验证 account 的白名单证明；双哈希叶子隔离叶子与内部节点，兄弟节点排序哈希。
    /// @dev 与 src/merkle.ts 一致：keccak256(bytes.concat(keccak256(abi.encode(account))))。
    function isWhitelisted(address account, bytes32[] calldata proof) public view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account))));
        return MerkleProof.verifyCalldata(proof, merkleRoot, leaf);
    }

    /// @notice 用调用者的 EIP-2612 签名授权本市场 value 个最小单位；不转移 Token。
    /// @dev owner 必须是 msg.sender，spender 固定本合约，不能拿别人签名替自己付款。
    ///      Token 校验 deadline、nonce、签名和域；错误直接回滚，不吞掉过期或重放错误。
    function permitPrePay(uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        IERC20Permit(address(paymentToken)).permit(msg.sender, address(this), value, deadline, v, r, s);
    }

    /// @notice 白名单调用者购买 tokenId，支付不超过 maxPayment 的五折金额，NFT 仅发给付款人。
    /// @param maxPayment 买家的最高实付价，阻止签名后卖家改价导致意外多扣款。
    /// @param proof 调用者的 Merkle 证明；白名单可购买多件，无每地址一次限购。
    function claimNFT(uint256 tokenId, uint256 maxPayment, bytes32[] calldata proof) external nonReentrant {
        require(isWhitelisted(msg.sender, proof), "Not whitelisted");
        Listing memory listing = listings[tokenId];
        require(listing.seller != address(0), "NFT not listed");
        // 避免 price+1 溢出；奇数最小单位向上取整，原价 1 不会变为免费。
        uint256 paid = listing.price / 2 + listing.price % 2;
        require(paid <= maxPayment, "Price exceeds maximum");

        // 先清挂单再外部调用；转币或接收 NFT 失败会恢复挂单、余额、额度及外层 Permit。
        delete listings[tokenId];
        paymentToken.safeTransferFrom(msg.sender, listing.seller, paid);
        nft.safeTransferFrom(listing.seller, msg.sender, tokenId);
        emit NFTSold(listing.seller, msg.sender, tokenId, paid);
    }
}
