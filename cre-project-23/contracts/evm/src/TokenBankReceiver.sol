// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @notice CRE Receiver 使用的最小 TokenBank 接口，避免复制银行实现。
interface ITokenBank {
    /// @notice 返回已记账的当前存款，不包含直接转币。
    function totalDeposits() external view returns (uint256);
    /// @notice 由授权 Receiver 划转半额，失败时回滚。
    function withdrawhalf(address recipient) external returns (uint256 amount);
}

/// @title TokenBankReceiver
/// @notice 接收 CRE Forwarder 报告，并在存款超过阈值时触发银行半额划转。
contract TokenBankReceiver is ReceiverTemplate {
    ITokenBank public immutable bank;
    address public immutable recipient;
    uint256 public immutable threshold;
    address public immutable trustedForwarder;
    uint256 public nextNonce = 1;

    event HalfWithdrawalExecuted(uint256 indexed amount, uint256 remainingDeposits, address indexed recipient);

    /// @notice 绑定 CRE Forwarder、目标银行、收款地址和触发阈值。
    /// @dev 银行必须随后把本合约配置为 automationReceiver；阈值使用 Token 最小单位。
    /// @param forwarder Chainlink CRE Keystone Forwarder 地址。
    /// @param bankAddress 已部署的 TokenBank 地址。
    /// @param recipientAddress 自动划转的 Token 接收地址。
    /// @param thresholdAmount 只有 totalDeposits 严格大于该值时才执行。
    constructor(address forwarder, address bankAddress, address recipientAddress, uint256 thresholdAmount)
        ReceiverTemplate(forwarder)
    {
        require(bankAddress.code.length > 0, "Invalid bank");
        require(recipientAddress != address(0) && recipientAddress != bankAddress, "Invalid recipient");
        require(thresholdAmount > 0, "Invalid threshold");
        bank = ITokenBank(bankAddress);
        recipient = recipientAddress;
        threshold = thresholdAmount;
        trustedForwarder = forwarder;
    }

    /// @notice 一次读取同一区块的金额、阈值、收款人和下一个报告序号，供 CRE 构建报告。
    function getState() external view returns (uint256 deposits, uint256 limit, address to, uint256 nonce) {
        return (bank.totalDeposits(), threshold, recipient, nextNonce);
    }

    /// @notice 供 CRE Cron 读取的条件检查。
    /// @return upkeepNeeded 存款总额超过阈值且可划转半额时返回 true。
    function needsUpkeep() external view returns (bool upkeepNeeded) {
        uint256 deposits = bank.totalDeposits();
        upkeepNeeded = deposits > threshold && deposits >= 2;
    }

    /// @notice 解码 CRE 报告并调用 TokenBank.withdrawhalf。
    /// @dev 只有 ReceiverTemplate 完成 Forwarder/工作流元数据校验后才会进入此函数。
    /// @param report ABI 编码的 uint256 nonce，成功后相同序号不能再执行。
    function _processReport(bytes calldata report) internal override {
        // 模板允许 owner 关闭 Forwarder 检查，本资金入口仍固定校验部署时的地址。
        require(msg.sender == trustedForwarder, "Untrusted forwarder");
        require(report.length == 32, "Invalid report");
        uint256 nonce = abi.decode(report, (uint256));
        require(nonce == nextNonce, "Stale report");

        uint256 deposits = bank.totalDeposits();
        require(deposits > threshold, "Threshold not met");
        // 先消费序号再进行外部调用；银行转账失败会一起回滚，允许原序号重试。
        nextNonce++;
        uint256 amount = bank.withdrawhalf(recipient);
        emit HalfWithdrawalExecuted(amount, deposits - amount, recipient);
    }
}
