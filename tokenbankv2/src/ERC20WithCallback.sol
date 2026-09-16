// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseERC20} from "./BaseERC20.sol";

/// @notice 带业务数据的接收接口，data 由接收合约自行解码。
interface ITokenReceiverWithData {
    function tokensReceived(address from, uint256 amount, bytes calldata data) external returns (bool);
}

/// @notice 扩展 ERC20：转账时把业务数据传给合约接收方。
contract ERC20WithCallback is BaseERC20 {
    /// @notice 转账并把额外业务数据原样传给接收合约。
    function transferWithCallback(address to, uint256 amount, bytes calldata data) external returns (bool) {
        super.transfer(to, amount);

        if (to.code.length > 0) {
            require(ITokenReceiverWithData(to).tokensReceived(msg.sender, amount, data), "ERC20: callback rejected");
        }
        return true;
    }
}
