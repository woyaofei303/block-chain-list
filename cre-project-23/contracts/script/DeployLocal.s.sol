// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseERC20} from "tokenbank/contracts/BaseERC20.sol";
import {TokenBank} from "tokenbank/contracts/TokenBank.sol";
import {TokenBankReceiver} from "../evm/src/TokenBankReceiver.sol";
import {Vm} from "./DeployTokenBankReceiver.s.sol";

/// @notice 部署本地完整 Token/Bank/Receiver，只有 chain 31337 可运行。
contract DeployLocalScript {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice 以 --sender 指定的 Anvil 解锁账户部署；阈值 100 枚，初始存款留给测试发起。
    /// @dev forwarder 是本地模拟发送者；此脚本不部署真实 DON 或验证 DON 签名。
    function run(address forwarder, address recipient)
        external
        returns (BaseERC20 token, TokenBank bank, TokenBankReceiver receiver)
    {
        require(block.chainid == 31337, "Local chain only");
        vm.startBroadcast();
        token = new BaseERC20();
        bank = new TokenBank(address(token));
        receiver = new TokenBankReceiver(forwarder, address(bank), recipient, 100 ether);
        bank.setAutomationReceiver(address(receiver));
        vm.stopBroadcast();
    }
}
