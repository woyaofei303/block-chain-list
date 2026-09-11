// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./TokenBank.sol";
import "./ERC20WithCallback.sol";

/// @notice 同时支持 approve + deposit 和 transferWithCallback 两种存款方式。
/// @dev 部署时绑定本项目 ERC20WithCallback；沿用父合约的无手续费、无 rebase 假设。
contract TokenBankV2 is TokenBank, ITokenReceiver {
    // 将 Token 地址交给父构造函数验证并保存；继承原有账本、事件、存款与提款。
    constructor(address tokenAddress) TokenBank(tokenAddress) {}

    /// @notice Token 在转账完成后自动调用此函数，用户不应手动调用。
    /// @param from 实际存款人，由受信任的 Token 合约传入。
    /// @param amount 本次已经到账的 Token 数量，单位与 balances 一致。
    function tokensReceived(address from, uint256 amount) external override returns (bool) {
        // 必须验证直接调用者，否则任何人都能伪造通知、凭空增加存款后提走真币。
        require(msg.sender == address(token), "Only supported token");
        require(amount > 0, "Amount must be positive");

        // 币已到账，只记一次账；不能再调用 deposit/transferFrom，否则会重复扣币。
        // 此时 msg.sender 是 Token 地址；应记到 from，不能记到 msg.sender 或 tx.origin。
        balances[from] += amount;
        emit Deposited(from, amount);
        return true;
    }
}
