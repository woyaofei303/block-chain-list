// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StakingPool} from "./StakingPool.sol";
import {IToken} from "./interfaces/IToken.sol";
import {ICEther} from "./interfaces/ICEther.sol";

/// @notice 加分版本：ETH 存入 Compound V2，每个用户保有自己取得的 cETH 份额。
contract CompoundStakingPool is StakingPool {
    ICEther public immutable cEther;
    mapping(address => uint256) public cTokenBalance;

    error InvalidMarket();
    error OnlyMarket();
    error AmountTooSmall();
    error RedeemFailed(uint256 code);

    /// @notice 固定可信的 cETH 市场，部署后不可更换；地址有代码不代表市场安全。
    constructor(IToken token, ICEther market) StakingPool(token) {
        if (address(market).code.length == 0) revert InvalidMarket();
        cEther = market;
    }

    /// @notice 只接收市场赎回的 ETH；仅检查 immutable 地址，兼容 cETH 的 2300 gas 转账。
    receive() external payable {
        if (msg.sender != address(cEther)) revert OnlyMarket();
    }

    /// @notice 存入原生 ETH，以本次实际新增 cETH 记账，避免新用户分走旧用户利息。
    function _depositETH(address account, uint256 amount) internal override {
        uint256 beforeBalance = cEther.balanceOf(address(this));
        cEther.mint{value: amount}();
        uint256 minted = cEther.balanceOf(address(this)) - beforeBalance;
        if (minted == 0) revert AmountTooSmall();
        cTokenBalance[account] += minted;
    }

    /// @notice 按赎回本金比例销毁该用户的 cETH；全退时取尽余量，利息随 ETH 一起返回。
    function _withdrawETH(address account, uint256 amount, uint256 previousBalance)
        internal
        override
        returns (uint256)
    {
        uint256 shares = Math.mulDiv(cTokenBalance[account], amount, previousBalance);
        if (shares == 0) revert AmountTooSmall();
        cTokenBalance[account] -= shares;
        uint256 beforeBalance = address(this).balance;
        uint256 code = cEther.redeem(shares);
        if (code != 0) revert RedeemFailed(code);
        uint256 received = address(this).balance - beforeBalance;
        if (received == 0) revert AmountTooSmall();
        return received;
    }
}
