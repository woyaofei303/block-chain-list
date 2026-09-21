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

    function setUp() public {
        collection = new BlocklightGenesis(address(this));
        recipient = makeAddr("recipient");
        stranger = makeAddr("stranger");
    }

    function testCollectionMetadata() public view {
        assertEq(collection.name(), "Blocklight Genesis");
        assertEq(collection.symbol(), "BLGT");
    }

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

    function testNonOwnerCannotMint() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        collection.safeMint(stranger, "ipfs://metadata/0.json");
    }

    function testSafeMintRejectsNonReceiver() public {
        NonReceiver target = new NonReceiver();

        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(target)));
        collection.safeMint(address(target), "ipfs://metadata/0.json");
    }
}
