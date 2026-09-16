// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage, ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BlocklightGenesis is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor(address initialOwner) ERC721("Blocklight Genesis", "BLGT") Ownable(initialOwner) {}

    function safeMint(address to, string calldata uri) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }
}
