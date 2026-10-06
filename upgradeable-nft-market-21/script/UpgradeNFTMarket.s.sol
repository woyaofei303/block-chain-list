// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {NFTMarketV1} from "../src/NFTMarketV1.sol";
import {NFTMarketV2} from "../src/NFTMarketV2.sol";

/// @notice 部署 V2 并升级已有市场代理；不会重新部署 NFT、支付币或代理。
/// @dev 代理地址和存储保留，调用改由 V2 实现处理；V2 必须兼容 V1 的存储布局。
contract UpgradeNFTMarket is Script {
    /// @notice 检查链、管理员与当前版本，再原子升级及初始化域，并核验原资产绑定不变。
    /// @dev 必填 DEPLOYER（当前 owner 的公开地址）、MARKET_PROXY（已有市场代理地址）；
    /// EXPECTED_CHAIN_ID 默认 31337。广播需由 --account 或本地 --unlocked 提供发送能力，脚本不读取私钥。
    /// 不带 --broadcast 时仅模拟；部署实现与升级代理是两笔交易，并非整个脚本原子执行。
    function run() external {
        // 1. 先核对 RPC 所在链，避免把同一个地址误当成另一条链上的目标。
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(31337)), "Unexpected chain");
        address deployer = vm.envAddress("DEPLOYER");
        address proxy = vm.envAddress("MARKET_PROXY");

        // 2. 排除无代码地址，再经代理读取状态。类型转换只选择调用 ABI，不会创建合约或切换实现。
        // 有代码不等于一定是 UUPS 代理；实际升级还受 onlyProxy、owner 权限和 UUPS 兼容性检查约束。
        require(proxy.code.length > 0, "Missing market proxy");
        NFTMarketV1 market = NFTMarketV1(proxy);
        require(market.owner() == deployer, "Deployer is not owner");
        // 此脚本只处理 V1 → V2；已经升级的代理会在部署新实现前被拒绝。
        require(market.version() == 1, "Expected V1");

        // 3. 保存原资产绑定，供模拟升级后比较；这里只核验地址，不遍历或迁移已有挂单。
        address token = address(market.paymentToken());
        address nft = address(market.nft());

        // 4. 以 deployer 为发送者记录后续两笔交易；是否真正发到链上由 CLI 的 --broadcast 决定。
        vm.startBroadcast(deployer);
        // 第一笔：部署 V2 逻辑。继承的构造器锁定实现合约初始化，业务状态仍保存在代理中。
        NFTMarketV2 implementation = new NFTMarketV2();

        // 5. 第二笔：通过旧代理切换实现，再 delegatecall V2.initializeV2()，在代理存储中初始化签名域。
        // abi.encodeCall 编码无参调用；initializeV2 的 reinitializer(2) 与 onlyOwner 限制版本和调用者。
        // 切换实现与初始化在同一笔交易内完成，初始化失败会回滚本笔升级，但不会撤销已确认的实现部署。
        market.upgradeToAndCall(address(implementation), abi.encodeCall(NFTMarketV2.initializeV2, ()));
        vm.stopBroadcast();

        // 6. 以下断言检查脚本模拟后的状态，不属于链上升级交易，不能撤销已经确认的交易。
        // market 仍指向原代理，version() 此时由 V2 返回；广播完成后还应通过 RPC 再读链上状态。
        require(market.version() == 2 && market.owner() == deployer, "Upgrade failed");
        require(address(market.paymentToken()) == token && address(market.nft()) == nft, "Assets changed");

        // 7. 输出沿用的代理地址与新实现地址；后续交易、授权及签名域中的市场地址继续使用代理。
        console2.log("MarketProxy", proxy);
        console2.log("MarketV2Implementation", address(implementation));
    }
}
