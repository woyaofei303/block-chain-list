// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../contracts/ERC20WithCallback.sol";
import "../contracts/TokenBankV2.sol";

/// @dev 模拟第二位用户。合约账户也能存取款，银行不能用 tx.origin 记账。
contract HookBankUser {
    function deposit(ERC20WithCallback token, TokenBankV2 bank, uint256 amount) external {
        token.transferWithCallback(address(bank), amount);
    }

    function withdraw(TokenBankV2 bank, uint256 amount) external {
        bank.withdraw(amount);
    }
}

/// @dev 仅供测试：0 接受、1 返回 false、2 revert；同时观察回调参数与到账顺序。
contract HookReceiver is ITokenReceiver {
    ERC20WithCallback public immutable token;
    uint8 public immutable mode;
    address public caller;
    address public from;
    uint256 public amount;
    uint256 public receivedBalance;
    uint256 public calls;

    constructor(ERC20WithCallback token_, uint8 mode_) {
        token = token_;
        mode = mode_;
    }

    function tokensReceived(address from_, uint256 amount_) external override returns (bool) {
        require(msg.sender == address(token), "Unexpected token");
        caller = msg.sender;
        from = from_;
        amount = amount_;
        receivedBalance = token.balanceOf(address(this));
        calls += 1;
        require(mode != 2, "Receiver reverted");
        return mode == 0;
    }
}
