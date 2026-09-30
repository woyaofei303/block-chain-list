// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @notice 可升级 ERC721；管理员铸造并控制 UUPS 升级，用户通过代理持有和授权 NFT。
contract UpgradeableNFT is ERC721Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    string private _tokenBaseURI;

    /// @notice 锁定实现地址，所有业务初始化必须发生在代理存储中。
    constructor() {
        _disableInitializers();
    }

    /// @notice 由代理构造函数原子调用一次，设置集合信息、URI 前缀和非零管理员。
    function initialize(address admin, string memory name_, string memory symbol_, string memory baseURI_)
        external
        initializer
    {
        __ERC721_init(name_, symbol_);
        __Ownable_init(admin);
        _tokenBaseURI = baseURI_;
    }

    /// @notice 管理员安全铸造指定编号；重复编号、零地址或不接受 NFT 的合约会回滚。
    function mint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId);
    }

    /// @notice 返回当前实现版本，便于通过代理核对升级结果。
    function version() external pure virtual returns (uint256) {
        return 1;
    }

    /// @notice 返回初始化时设置的 URI 前缀；ERC721 将其与 tokenId 拼接。
    function _baseURI() internal view override returns (string memory) {
        return _tokenBaseURI;
    }

    /// @notice 仅代理的管理员可升级；UUPS 基类继续验证新实现的兼容接口。
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
