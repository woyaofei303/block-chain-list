// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ISignatureTransfer} from "../lib/permit2/src/interfaces/ISignatureTransfer.sol";

interface IIdempotentToken {
    /// @notice 提款时从银行余额把币归还用户；返回 false 时银行应回滚本次提款。
    function transfer(address to, uint256 amount) external returns (bool);
    /// @notice 存款时使用用户授予银行的额度转币；不会自动给银行增加授权。
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPermitToken {
    /// @notice 代币验证 owner 的签名后更新授权；签名中的 spender 在本流程中为银行。
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @notice 新部署的幂等银行；原 TokenBank 部署与余额不受影响。
contract IdempotentTokenBank {
    IIdempotentToken public immutable token;
    ISignatureTransfer public immutable permit2;
    mapping(address => uint256) public balances;
    // 地址隔离不同用户；编号对应操作内容的哈希，不是交易哈希或代币余额。
    mapping(address => mapping(bytes32 => bytes32)) public operationHash;
    bool private entered;

    event OperationExecuted(address indexed user, bytes32 indexed operationId, bool deposit, uint256 amount);

    /// @notice 固定 Token 和 Permit2 地址；Permit2 为零时仅关闭该入口，其他存款方式仍可用。
    constructor(address tokenAddress, address permit2Address) {
        require(tokenAddress.code.length > 0, "Invalid token");
        require(permit2Address == address(0) || permit2Address.code.length > 0, "Invalid Permit2");
        token = IIdempotentToken(tokenAddress);
        // 零地址只用于禁用 Permit2 的兼容部署。
        permit2 = ISignatureTransfer(permit2Address);
    }

    /// @notice 存取款过程中锁住其他存取入口，防止代币回调把未完成的操作再执行一遍。
    modifier nonReentrant() {
        require(!entered, "Reentrant call");
        entered = true;
        _;
        entered = false;
    }

    /// @notice 按现有授权存入 amount；同一账户以同编号、同参数重试时不再扣币。
    function deposit(uint256 amount, bytes32 operationId) external nonReentrant {
        if (!_begin(operationId, true, amount)) return;
        _deposit(amount, operationId);
    }

    /// @notice 供页面识别本银行有签名存款入口；不代表钱包一定支持所有签名方式。
    function supportsPermit() external pure returns (bool) {
        return true;
    }

    /// @notice 把签名授权和存款合成一次调用；已有足够额度时，permit 被提前使用也能继续。
    /// 授权尝试失败并不直接判定存款成功，后面的 transferFrom 仍须实际扣到代币。
    function permitDeposit(uint256 amount, bytes32 operationId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        // 与普通存款使用同一个操作编号；重放不再次授权或转币。
        if (!_begin(operationId, true, amount)) return;
        require(block.timestamp <= deadline, "Permit expired");
        // 他人可提前提交 permit，已有足够 allowance 时本人仍可继续存款。
        try IPermitToken(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(amount, operationId);
    }

    /// @notice 先通过 Token 转入真实资产，成功后才增加个人存款并发出操作事件。
    function _deposit(uint256 amount, bytes32 operationId) private {
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        _creditDeposit(amount, operationId);
    }

    /// @notice 让 Permit2 使用一次性签名转币到银行；用户须事先授权 Token 给 Permit2。
    /// 操作编号也作为 Permit2 nonce，避免同一签名再用一次；所有入口仍共用银行账本。
    function depositWithPermit2(uint256 amount, bytes32 operationId, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        if (!_begin(operationId, true, amount)) return;
        require(address(permit2) != address(0), "Permit2 unavailable");
        // operationId 同时作为一次性 nonce；签名绑定本银行、Token、金额和操作编号。
        // 付款人固定为调用者，收款人固定为银行，不能代用他人的签名改变记账归属。
        permit2.permitTransferFrom(
            ISignatureTransfer.PermitTransferFrom({
                permitted: ISignatureTransfer.TokenPermissions({token: address(token), amount: amount}),
                nonce: uint256(operationId),
                deadline: deadline
            }),
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: amount}),
            msg.sender,
            signature
        );
        _creditDeposit(amount, operationId);
    }

    /// @notice 转币成功后统一记账；按 amount 入账，因此只支持没有转账手续费或 rebase 的代币。
    function _creditDeposit(uint256 amount, bytes32 operationId) private {
        balances[msg.sender] += amount;
        emit OperationExecuted(msg.sender, operationId, true, amount);
    }

    /// @notice 按个人账本提款；先扣账再转币，同编号的成功提款不会重复付款。
    function withdraw(uint256 amount, bytes32 operationId) external nonReentrant {
        if (!_begin(operationId, false, amount)) return;
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
        emit OperationExecuted(msg.sender, operationId, false, amount);
    }

    /// @notice 首次使用编号时占号并返回 true；相同操作返回 false，换金额或动作则拒绝。
    /// 例如编号 X 已存入 10，重试 X/存入/10 不动钱，改成 X/存入/20 会报冲突。
    function _begin(bytes32 operationId, bool isDeposit, uint256 amount) private returns (bool) {
        require(operationId != bytes32(0) && amount > 0, "Invalid operation");
        bytes32 payload = keccak256(abi.encode(isDeposit, amount));
        bytes32 previous = operationHash[msg.sender][operationId];
        if (previous != bytes32(0)) {
            require(previous == payload, "Operation conflict");
            return false;
        }
        // 外部转币前占号；任何后续失败都连同此标记一起回滚。
        operationHash[msg.sender][operationId] = payload;
        return true;
    }
}
