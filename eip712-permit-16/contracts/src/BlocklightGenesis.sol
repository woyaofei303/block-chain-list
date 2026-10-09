// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BlocklightGenesis is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    /// @notice 设置集合名称与铸造管理员；initialOwner 不一定是部署交易的发送者。
    constructor(address initialOwner) ERC721("Blocklight Genesis", "BLGT") Ownable(initialOwner) {}

    /// @notice 管理员给 to 铸造下一号 NFT 并保存元数据地址；接收失败时编号也回滚。
    function safeMint(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
