// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIdempotentToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPermitToken {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @notice 新部署的幂等银行；原 TokenBank 部署与余额不受影响。
contract IdempotentTokenBank {
    IIdempotentToken public immutable token;
    mapping(address => uint256) public balances;
    mapping(address => mapping(bytes32 => bytes32)) public operationHash;
    bool private entered;

    event OperationExecuted(address indexed user, bytes32 indexed operationId, bool deposit, uint256 amount);

    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IIdempotentToken(tokenAddress);
    }

    modifier nonReentrant() {
        require(!entered, "Reentrant call");
        entered = true;
        _;
        entered = false;
    }

    function deposit(uint256 amount, bytes32 operationId) external nonReentrant {
        if (!_begin(operationId, true, amount)) return;
        _deposit(amount, operationId);
    }

    function supportsPermit() external pure returns (bool) {
        return true;
    }

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

    function _deposit(uint256 amount, bytes32 operationId) private {
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        balances[msg.sender] += amount;
        emit OperationExecuted(msg.sender, operationId, true, amount);
    }

    function withdraw(uint256 amount, bytes32 operationId) external nonReentrant {
        if (!_begin(operationId, false, amount)) return;
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");
        balances[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
        emit OperationExecuted(msg.sender, operationId, false, amount);
    }

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
