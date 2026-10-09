// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {BlocklightGenesis} from "../src/BlocklightGenesis.sol";

contract DeployAndMint is Script {
    /// @notice 先部署，再给 owner 铸造 0、1、2 号 NFT；CID 对应已准备好的元数据目录。
    /// @dev 广播账户必须等于 NFT_OWNER，否则部署后的 onlyOwner 铸造会失败。
    /// 没有 --broadcast 时仅模拟；三次铸造是此脚本的安排，不是合约发行上限。
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
