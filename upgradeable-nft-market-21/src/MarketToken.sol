// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 带业务数据的 ERC20 收款回调；返回 false 或回滚都会撤销转账。
interface ITokenReceiver {
    /// @notice 接收 from 已支付的 amount，data 由收款合约按业务规则解码。
    function tokensReceived(address from, uint256 amount, bytes calldata data) external returns (bool);
}

/// @notice 教学支付币：固定发行一百万枚给部署者，18 位精度，无增发入口。
contract MarketToken is ERC20 {
    /// @notice 构造时一次性发行；本合约不使用代理。
    constructor() ERC20("Market Token", "MKT") {
        _mint(msg.sender, 1_000_000 ether);
    }

    /// @notice 先转账再通知合约收款方，回调失败则整个交易回滚。
    function transferWithCallback(address to, uint256 amount, bytes calldata data) external returns (bool) {
        _transfer(msg.sender, to, amount);
        if (to.code.length > 0) {
            require(ITokenReceiver(to).tokensReceived(msg.sender, amount, data), "Callback rejected");
        }
        return true;
    }
}
