// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/IERC6093.sol";
import {BlocklightGenesis} from "../src/BlocklightGenesis.sol";

contract NonReceiver {}

contract BlocklightGenesisTest is Test {
    BlocklightGenesis private collection;
    address private recipient;
    address private stranger;

    /// @notice 每次重新部署集合，让测试合约当管理员，另准备收款人与陌生账户。
    function setUp() public {
        collection = new BlocklightGenesis(address(this));
        recipient = makeAddr("recipient");
        stranger = makeAddr("stranger");
    }

    /// @notice 集合名称与符号属于合约配置，不从单件 NFT 的 JSON 读取。
    function testCollectionMetadata() public view {
        assertEq(collection.name(), "Blocklight Genesis");
        assertEq(collection.symbol(), "BLGT");
    }

    /// @notice 连续铸两件得到编号 0 和 1，各自持有人和元数据地址都要对应正确。
    function testOwnerMintsSequentialIdsAndStoresUris() public {
        uint256 firstId = collection.safeMint(recipient, "ipfs://metadata/0.json");
        uint256 secondId = collection.safeMint(recipient, "ipfs://metadata/1.json");

        assertEq(firstId, 0);
        assertEq(secondId, 1);
        assertEq(collection.ownerOf(0), recipient);
        assertEq(collection.ownerOf(1), recipient);
        assertEq(collection.tokenURI(0), "ipfs://metadata/0.json");
        assertEq(collection.tokenURI(1), "ipfs://metadata/1.json");
    }

    /// @notice 陌生账户不能给自己铸造；报错须确实来自管理员权限检查。
    function testNonOwnerCannotMint() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        collection.safeMint(stranger, "ipfs://metadata/0.json");
    }

    /// @notice 收款地址是合约却不支持接收回调时拒绝铸造，避免 NFT 被锁在其中。
    function testSafeMintRejectsNonReceiver() public {
        NonReceiver target = new NonReceiver();

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(target)));
        collection.safeMint(address(target), "ipfs://metadata/0.json");
    }
}
