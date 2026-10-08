// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenBankReceiver} from "../evm/src/TokenBankReceiver.sol";

interface Vm {
    /// @notice 后续外部调用作为显式 CLI sender 的交易；不读取私钥。
    function startBroadcast() external;
    /// @notice 结束广播记录。
    function stopBroadcast() external;
}

/// @notice 部署 CRE Receiver；银行 owner 需另行调用 setAutomationReceiver 完成绑定。
contract DeployTokenBankReceiverScript {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ReceiverDeployed(
        address indexed receiver, address indexed bank, address indexed recipient, uint256 threshold
    );

    /// @notice 使用显式参数部署 Receiver，默认只模拟，传 --broadcast 才发送交易。
    /// @param bankAddress 已部署 TokenBank 地址。
    /// @param forwarderAddress CRE Keystone Forwarder 地址。
    /// @param recipientAddress 半额 Token 接收地址。
    /// @param thresholdAmount 触发阈值，使用 Token 最小单位。
    /// @param workflowId 正式部署绑定的 CRE workflow ID；模拟使用零值且只在本地链允许。
    function run(
        address bankAddress,
        address forwarderAddress,
        address recipientAddress,
        uint256 thresholdAmount,
        bytes32 workflowId
    ) external returns (TokenBankReceiver receiver) {
        require(workflowId != bytes32(0) || block.chainid == 31337, "Workflow ID required outside local chain");
        vm.startBroadcast();
        receiver = new TokenBankReceiver(forwarderAddress, bankAddress, recipientAddress, thresholdAmount);
        if (workflowId != bytes32(0)) receiver.setExpectedWorkflowId(workflowId);
        vm.stopBroadcast();
        emit ReceiverDeployed(address(receiver), bankAddress, recipientAddress, thresholdAmount);
    }
}
