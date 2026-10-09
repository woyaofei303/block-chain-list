// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV2Factory} from "../src/core/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "../src/core/interfaces/IUniswapV2Pair.sol";
import {IERC20} from "../src/core/interfaces/IERC20.sol";
import {IUniswapV2Router02} from "../src/periphery/interfaces/IUniswapV2Router02.sol";

/// @notice 在隔离 Anvil 部署原版 V2 与教学池；不支持公共链广播。
contract DeployUniswapV2 is Script {
    /// @notice 按 Factory、WETH、Router、双币顺序部署，再注入 10000 A / 20000 B；发送者持有 LP 与管理权。
    function run() external {
        require(block.chainid == 31337, "local chain only");
        address deployer = msg.sender;
        vm.startBroadcast();
        IUniswapV2Factory factory =
            IUniswapV2Factory(deployCode("UniswapV2Factory.sol:UniswapV2Factory", abi.encode(deployer)));
        address weth = deployCode("WETH9.sol:WETH9");
        IUniswapV2Router02 router = IUniswapV2Router02(
            deployCode("UniswapV2Router02.sol:UniswapV2Router02", abi.encode(address(factory), weth))
        );
        IERC20 tokenA = IERC20(deployCode("ERC20.sol:ERC20", abi.encode(1_000_000 ether)));
        IERC20 tokenB = IERC20(deployCode("ERC20.sol:ERC20", abi.encode(1_000_000 ether)));
        require(tokenA.approve(address(router), 10_000 ether), "approve A failed");
        require(tokenB.approve(address(router), 20_000 ether), "approve B failed");
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            10_000 ether,
            20_000 ether,
            10_000 ether,
            20_000 ether,
            deployer,
            block.timestamp + 600
        );
        vm.stopBroadcast();

        address pair = factory.getPair(address(tokenA), address(tokenB));
        require(pair.code.length > 0 && IUniswapV2Pair(pair).balanceOf(deployer) > 0, "pool missing");
        require(factory.feeToSetter() == deployer, "wrong administrator");
        require(router.factory() == address(factory) && router.WETH() == weth, "wrong router config");
        console2.log("Factory", address(factory));
        console2.log("WETH9", weth);
        console2.log("Router02", address(router));
        console2.log("TokenA", address(tokenA));
        console2.log("TokenB", address(tokenB));
        console2.log("Pair", pair);
        console2.log("LP balance", IUniswapV2Pair(pair).balanceOf(deployer));
        console2.log("Pair init code hash:");
        console2.logBytes32(keccak256(vm.getCode("UniswapV2Pair.sol:UniswapV2Pair")));
    }
}
