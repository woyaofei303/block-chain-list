// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {MyToken} from "../src/MyToken.sol";
import {FlashSwap} from "../src/FlashSwap.sol";

/// @notice 部署两套 Factory/Router 和两个 MyToken，添加不同价格的流动性，最后部署套利合约。
contract DeployFlashSwap is Script {
    string constant ARTIFACTS = "../output-tdd/uniswap-v2-25/out/";

    /// @notice 仅允许本地或 Sepolia；不含私钥，模拟不广播，广播时使用命令行指定的钱包。
    function run() external {
        require(block.chainid == 31337 || block.chainid == 11155111, "unsupported chain");
        address deployer = msg.sender;
        vm.startBroadcast();
        MyToken tokenA = new MyToken("MyToken A", "MTA");
        MyToken tokenB = new MyToken("MyToken B", "MTB");
        address weth = deployCode(string.concat(ARTIFACTS, "WETH9.sol/WETH9.json"));
        (address factoryA, address routerA) = _market(deployer, weth);
        (address factoryB, address routerB) = _market(deployer, weth);
        _seed(tokenA, tokenB, routerA, 20_000 ether, deployer);
        _seed(tokenA, tokenB, routerB, 30_000 ether, deployer);
        FlashSwap arb = new FlashSwap(factoryA, factoryB, address(tokenA), address(tokenB));
        vm.stopBroadcast();

        require(arb.owner() == deployer, "wrong owner");
        require(arb.poolA().balanceOf(deployer) > 0 && arb.poolB().balanceOf(deployer) > 0, "missing LP");
        console2.log("Chain ID", block.chainid);
        console2.log("Deployer", deployer);
        console2.log("TokenA", address(tokenA));
        console2.log("TokenB", address(tokenB));
        console2.log("WETH9", weth);
        console2.log("FactoryA", factoryA);
        console2.log("FactoryB", factoryB);
        console2.log("RouterA", routerA);
        console2.log("RouterB", routerB);
        console2.log("PoolA", address(arb.poolA()));
        console2.log("PoolB", address(arb.poolB()));
        console2.log("FlashSwap", address(arb));
    }

    /// @notice 复用 25 的旧编译器产物，确保 Router 的 pairFor 哈希与 Factory 实际部署的 Pair 一致。
    function _market(address deployer, address weth) internal returns (address factory, address router) {
        factory =
            deployCode(string.concat(ARTIFACTS, "UniswapV2Factory.sol/UniswapV2Factory.json"), abi.encode(deployer));
        router = deployCode(
            string.concat(ARTIFACTS, "UniswapV2Router02.sol/UniswapV2Router02.json"), abi.encode(factory, weth)
        );
    }

    /// @notice 每池投入 1 万 A，B 数量决定初始价格；只授权本次金额，LP 留在部署账户。
    function _seed(MyToken a, MyToken b, address router, uint256 amountB, address deployer) internal {
        require(a.approve(router, 10_000 ether) && b.approve(router, amountB), "approve failed");
        (uint256 addedA, uint256 addedB, uint256 liquidity) = IUniswapV2Router02(router)
            .addLiquidity(
                address(a), address(b), 10_000 ether, amountB, 10_000 ether, amountB, deployer, block.timestamp + 600
            );
        require(addedA == 10_000 ether && addedB == amountB && liquidity > 0, "wrong liquidity");
    }
}
