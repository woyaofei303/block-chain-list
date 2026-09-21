// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenBank} from "../src/TokenBank.sol";

// startBroadcast 会让其中产生的合约创建交易使用命令行指定的部署账户。
interface TokenBankDeployVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice 部署绑定 Sepolia USDT 的 TokenBank。默认只模拟，--broadcast 才发送交易。
contract DeployTokenBankScript {
    TokenBankDeployVm private constant vm = TokenBankDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Aave V3 Sepolia 地址簿登记的 USDT 测试 Token。
    address public constant SEPOLIA_USDT = 0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0;

    // -vvvv 模拟输出会显示 TokenBank 地址和它绑定的 Token 地址。
    event TokenBankDeployed(address indexed tokenBank, address indexed token);

    function run() external returns (TokenBank tokenBank) {
        // 使用 --rpc-url 连接 Sepolia 后，这项检查可以提前发现网络或地址配置错误。
        require(SEPOLIA_USDT.code.length > 0, "Sepolia USDT contract not found");

        vm.startBroadcast();
        tokenBank = new TokenBank(SEPOLIA_USDT);
        vm.stopBroadcast();

        require(address(tokenBank.token()) == SEPOLIA_USDT, "TokenBank token mismatch");
        emit TokenBankDeployed(address(tokenBank), SEPOLIA_USDT);
    }
}
