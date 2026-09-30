// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NFTMarketV1} from "../src/NFTMarketV1.sol";
import {NFTMarketV2} from "../src/NFTMarketV2.sol";

/// @notice 部署 V2 并升级已有市场代理；不会重新部署 NFT、支付币或代理。
contract UpgradeNFTMarket is Script {
    /// @notice 检查链、管理员与当前版本，再原子升级及初始化域，并核验原资产绑定不变。
    function run() external {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(31337)), "Unexpected chain");
        address deployer = vm.envAddress("DEPLOYER");
        address proxy = vm.envAddress("MARKET_PROXY");
        require(proxy.code.length > 0, "Missing market proxy");
        NFTMarketV1 market = NFTMarketV1(proxy);
        require(market.owner() == deployer, "Deployer is not owner");
        require(market.version() == 1, "Expected V1");
        address token = address(market.paymentToken());
        address nft = address(market.nft());
        vm.startBroadcast(deployer);
        NFTMarketV2 implementation = new NFTMarketV2();
        market.upgradeToAndCall(address(implementation), abi.encodeCall(NFTMarketV2.initializeV2, ()));
        vm.stopBroadcast();
        require(market.version() == 2 && market.owner() == deployer, "Upgrade failed");
        require(address(market.paymentToken()) == token && address(market.nft()) == nft, "Assets changed");
        console2.log("MarketProxy", proxy);
        console2.log("MarketV2Implementation", address(implementation));
    }
}
