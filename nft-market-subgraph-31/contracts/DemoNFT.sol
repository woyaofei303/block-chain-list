// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @notice 给索引练习提供可查询 tokenURI 的 NFT，只有部署者可以铸造。
contract DemoNFT is ERC721URIStorage {
    address public immutable minter;

    /// @notice 将部署者设为唯一铸造人；不在部署时自动铸造或上架。
    constructor() ERC721("Graph Market NFT", "GMNFT") {
        minter = msg.sender;
    }

    /// @notice 铸造指定编号并保存元数据 URI；重复编号和非部署者调用都会回滚。
    function mint(address to, uint256 tokenId, string calldata uri) external {
        require(msg.sender == minter, "Only minter");
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
