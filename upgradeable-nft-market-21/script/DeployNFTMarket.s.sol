// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpgradeableNFT} from "../src/UpgradeableNFT.sol";
import {NFTMarketV1} from "../src/NFTMarketV1.sol";
import {MarketToken} from "../src/MarketToken.sol";

/// @notice 部署支付币、NFT 实现与代理、市场 V1 实现与代理；不自动铸造 NFT、授权或进行买卖。
/// @dev NFT 与市场均采用 UUPS：实现提供逻辑，ERC1967Proxy 保存业务状态并转发调用。
contract DeployNFTMarket is Script {
    /// @notice 检查链后按依赖顺序部署，代理构造时原子初始化；无 --broadcast 时仅模拟。
    /// @dev DEPLOYER 是公开地址，由 --account 或本地 --unlocked 提供签名能力，脚本不读取私钥。
    /// EXPECTED_CHAIN_ID 默认 31337；DEPLOYER 必须非零，将接收全部支付币并成为两个代理的 owner。
    /// 整个部署包含五笔独立交易，后续交易失败不会撤销已确认的部署；重复运行会创建一套新合约。
    function run() external {
        // 1. 在生成部署交易前核对目标链与管理员地址，避免部署到错误网络或初始化为零管理员。
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(31337)), "Unexpected chain");
        address deployer = vm.envAddress("DEPLOYER");
        require(deployer != address(0), "Zero deployer");

        // 2. 记录以 deployer 为发送者的后续部署交易；startBroadcast 本身不会让 CLI 自动广播。
        // CLI 带 --broadcast 才发送交易；本地 --unlocked 使用 Anvil 解锁账户，公共链使用对应签名账户。
        vm.startBroadcast(deployer);

        // 3. 第一笔：部署非代理支付币，构造器向 deployer 发行 1,000,000 MKT（18 位精度）。
        // 先得到支付币地址，后面才能把市场绑定到这一种结算资产。
        MarketToken token = new MarketToken();

        // 4. 第二笔：部署 NFT 逻辑；构造器锁定实现合约初始化，NFT 状态由下一笔创建的代理保存。
        UpgradeableNFT nftImplementation = new UpgradeableNFT();
        // 第三笔：创建 NFT 代理，并在构造过程中 delegatecall initialize，设置管理员、名称、符号及 URI。
        // abi.encodeCall 只编码调用并在编译时检查参数；真正的初始化由代理构造器执行。
        // 代理创建与初始化在同一笔交易中完成，初始化失败则该代理部署回滚，不留下未初始化的代理。
        ERC1967Proxy nft = new ERC1967Proxy(
            address(nftImplementation),
            abi.encodeCall(UpgradeableNFT.initialize, (deployer, "Upgradeable NFT", "UNFT", "https://example.com/nft/"))
        );

        // 5. 第四笔：部署市场 V1 逻辑；同样锁定实现初始化，后续升级只替换代理指向的实现。
        NFTMarketV1 marketImplementation = new NFTMarketV1();
        // 第五笔：创建并原子初始化市场代理，绑定支付币、NFT 代理和管理员。
        // 必须传 NFT 代理地址：NFT 所有权保存在代理中，市场通过这个稳定地址查询和转移 NFT。
        ERC1967Proxy market = new ERC1967Proxy(
            address(marketImplementation),
            abi.encodeCall(NFTMarketV1.initialize, (address(token), address(nft), deployer))
        );

        // 6. 结束交易记录；后面的日志只输出地址，不会新增链上交易。
        vm.stopBroadcast();
        // 后续铸造、授权与买卖使用代理地址；实现地址用于核验和源码验证。
        // 模拟也会打印地址，不能仅凭日志认定已部署；广播后须结合回执及 RPC 读取确认。
        console2.log("PaymentToken", address(token));
        console2.log("NFTImplementation", address(nftImplementation));
        console2.log("NFTProxy", address(nft));
        console2.log("MarketV1Implementation", address(marketImplementation));
        console2.log("MarketProxy", address(market));
    }
}
