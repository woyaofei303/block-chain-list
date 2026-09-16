// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {BlocklightGenesis} from "../src/BlocklightGenesis.sol";

contract DeployAndMint is Script {
    function run() external returns (BlocklightGenesis collection) {
        address owner = vm.envAddress("NFT_OWNER");
        string memory cid = vm.envString("METADATA_CID");

        vm.startBroadcast();
        collection = new BlocklightGenesis(owner);
        collection.safeMint(owner, string.concat("ipfs://", cid, "/0.json"));
        collection.safeMint(owner, string.concat("ipfs://", cid, "/1.json"));
        collection.safeMint(owner, string.concat("ipfs://", cid, "/2.json"));
        vm.stopBroadcast();
    }
}
