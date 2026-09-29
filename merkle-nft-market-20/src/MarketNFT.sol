// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice 同一开发者发行的演示 NFT，仅部署者可铸造，编号从 0 开始。
contract MarketNFT is ERC721, Ownable {
    uint256 public nextTokenId;

    /// @notice 设置集合名称并将部署者设为铸造管理员。
    constructor() ERC721("Merkle Market NFT", "MMNFT") Ownable(msg.sender) {}

    /// @notice 管理员给 to 安全铸造一枚 NFT；零地址或拒收合约会回滚，包括编号递增。
    /// @return tokenId 本次成功铸造的编号。
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
    }
}
