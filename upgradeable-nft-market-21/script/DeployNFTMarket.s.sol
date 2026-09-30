// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableNFT} from "../src/UpgradeableNFT.sol";
import {NFTMarketV1} from "../src/NFTMarketV1.sol";
import {MarketToken} from "../src/MarketToken.sol";

/// @notice 部署支付币、NFT 实现与代理、市场 V1 实现与代理；不自动铸造或进行交易。
contract DeployNFTMarket is Script {
    /// @notice 检查链后按依赖顺序部署，代理构造时原子初始化；无 --broadcast 时仅模拟。
    /// @dev DEPLOYER 是公开地址，由 --account 或本地 --unlocked 提供签名能力，脚本不读取私钥。
    function run() external {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(31337)), "Unexpected chain");
        address deployer = vm.envAddress("DEPLOYER");
        require(deployer != address(0), "Zero deployer");
        vm.startBroadcast(deployer);
        MarketToken token = new MarketToken();
        UpgradeableNFT nftImplementation = new UpgradeableNFT();
        ERC1967Proxy nft = new ERC1967Proxy(
            address(nftImplementation),
            abi.encodeCall(UpgradeableNFT.initialize, (deployer, "Upgradeable NFT", "UNFT", "https://example.com/nft/"))
        );
        NFTMarketV1 marketImplementation = new NFTMarketV1();
        ERC1967Proxy market = new ERC1967Proxy(
            address(marketImplementation),
            abi.encodeCall(NFTMarketV1.initialize, (address(token), address(nft), deployer))
        );
        vm.stopBroadcast();
        console2.log("PaymentToken", address(token));
        console2.log("NFTImplementation", address(nftImplementation));
        console2.log("NFTProxy", address(nft));
        console2.log("MarketV1Implementation", address(marketImplementation));
        console2.log("MarketProxy", address(market));
    }
}
