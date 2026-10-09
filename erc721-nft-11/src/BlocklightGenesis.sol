// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BlocklightGenesis is ERC721URIStorage, Ownable {
    // tokenId 从 0 开始；它是编号，不是发行上限，也不是持有人数量。
    uint256 private _nextTokenId;

    /// @notice 把铸造权限交给 initialOwner；它可以与实际部署合约的账户不同。
    constructor(address initialOwner) ERC721("Blocklight Genesis", "BLGT") Ownable(initialOwner) {}

    /// @notice 管理员给 to 铸造下一号 NFT，并保存指向元数据的 uri。
    /// @dev 收款合约必须支持 ERC721 接收回调；失败时编号递增和铸造一起回滚。
    function safeMint(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        // uri 通常指向描述名称、图片等信息的 JSON；图片本身不存进合约。
        _setTokenURI(tokenId, uri);
    }
}
