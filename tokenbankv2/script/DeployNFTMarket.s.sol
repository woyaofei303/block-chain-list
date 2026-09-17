// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC20WithCallback} from "../src/ERC20WithCallback.sol";
import {NFTMarket} from "../src/NFTMarket.sol";

contract DeployNFTMarket is Script {
    function run() external returns (ERC20WithCallback token, NFTMarket market) {
        address nftAddress = vm.envAddress("NFT_ADDRESS");

        vm.startBroadcast();
        token = new ERC20WithCallback();
        market = new NFTMarket(address(token), nftAddress);
        vm.stopBroadcast();

        console2.log("ERC20WithCallback", address(token));
        console2.log("NFTMarket", address(market));
    }
}
