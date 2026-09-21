// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIdempotentToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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
