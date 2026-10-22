// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DemoNFT} from "../contracts/DemoNFT.sol";
import {NFTMarket} from "market08/NFTMarket.sol";
import {ERC20WithCallback} from "market08/ERC20WithCallback.sol";

contract Deploy is Script {
    /// @notice 依次部署 NFT、支付币和市场；仅支持 Anvil/Sepolia，默认模拟，广播需显式 CLI 参数。
    function run() public returns (DemoNFT nft, ERC20WithCallback token, NFTMarket market) {
        require(block.chainid == 31337 || block.chainid == 11155111, "Unsupported chain");
        vm.startBroadcast();
        nft = new DemoNFT();
        token = new ERC20WithCallback();
        market = new NFTMarket(address(token), address(nft));
        vm.stopBroadcast();
        console2.log("NFT", address(nft));
        console2.log("PAY_TOKEN", address(token));
        console2.log("MARKET", address(market));
    }

    /// @notice 部署后由部署者自买 1 号 NFT，生成演示上架/成交；共 8 笔交易，100 BERC20 授权恰好用完。
    /// @dev 仅在明确授权公共链部署和演示时调用；run() 仍只部署，不会自动交易。
    function runWithDemo() external returns (DemoNFT nft, ERC20WithCallback token, NFTMarket market) {
        (nft, token, market) = run();
        address owner = nft.minter();
        vm.startBroadcast();
        nft.mint(
            owner,
            1,
            'data:application/json;utf8,{"name":"Graph Market Demo #1","description":"Sepolia self-purchase indexing demo"}'
        );
        nft.approve(address(market), 1);
        market.list(1, 100 ether);
        token.approve(address(market), 100 ether);
        market.buyNFT(1);
        vm.stopBroadcast();
        require(nft.ownerOf(1) == owner, "Unexpected NFT owner");
        require(token.allowance(owner, address(market)) == 0, "Unused allowance");
    }
}
