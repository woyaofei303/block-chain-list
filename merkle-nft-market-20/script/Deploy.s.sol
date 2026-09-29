// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {PermitToken} from "../src/PermitToken.sol";
import {MarketNFT} from "../src/MarketNFT.sol";
import {AirdopMerkleNFTMarket} from "../src/AirdopMerkleNFTMarket.sol";

/// @notice 仅用于本地 Anvil 的顺序部署入口，不读取密钥、不自动铸造或上架。
contract Deploy is Script {
    /// @notice 以 deployer 部署 Token → NFT → 市场；deployer 获得 Token 并成为 NFT owner。
    /// @param deployer 本地 RPC 解锁账户，也是 forge script 的 --sender。
    /// @param root src/merkle.ts 输出的白名单根。
    /// @dev 不传 --broadcast 只模拟；部署广播需额外传 --unlocked --broadcast。
    function run(address deployer, bytes32 root)
        external
        returns (PermitToken token, MarketNFT nft, AirdopMerkleNFTMarket market)
    {
        require(block.chainid == 31337, "Local Anvil only");
        require(deployer != address(0), "Zero deployer");
        require(root != bytes32(0), "Empty root");
        vm.startBroadcast(deployer);
        token = new PermitToken();
        nft = new MarketNFT();
        market = new AirdopMerkleNFTMarket(address(token), address(nft), root);
        vm.stopBroadcast();
    }
}
