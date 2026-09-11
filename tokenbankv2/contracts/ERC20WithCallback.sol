// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./BaseERC20.sol";

/// @notice 本练习约定的接收接口；不是 ERC20 标准的一部分。
interface ITokenReceiver {
    /// @param from 原始转账人；接收方看到的 msg.sender 是 Token 合约。
    /// @param amount 已转入的 Token 最小单位数量。
    /// @return 接收方返回 true 表示接受，false 或 revert 表示拒收。
    function tokensReceived(address from, uint256 amount) external returns (bool);
}

/// @notice 继承原版 ERC20，只为新入口增加回调，普通 transfer/transferFrom 保持原样。
contract ERC20WithCallback is BaseERC20 {
    /// @notice 用户直接转出自己的 Token，无需 approve；合约接收方必须接受回调。
    function transferWithCallback(address to, uint256 amount) external returns (bool) {
        // 内部调用父合约，msg.sender 仍是用户；不要使用 this.transfer，后者会改变调用者。
        // 先更新双方余额，再调用外部接收方，回调中查询到的是转账后的余额。
        super.transfer(to, amount);

        // 检查当前是否有代码；构造中的合约尚无运行时代码，不能据此判断账户身份。
        if (to.code.length > 0) {
            // 不吞掉错误：缺少接口、回调 revert 或返回 false 时，整笔转账及事件回滚。
            require(ITokenReceiver(to).tokensReceived(msg.sender, amount), "ERC20: callback rejected");
        }
        return true;
    }
}
