// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIdempotentToken {
    /// @notice 提款时从银行余额把币归还用户；返回 false 时银行应回滚本次提款。
    function transfer(address to, uint256 amount) external returns (bool);
    /// @notice 存款时使用用户授予银行的额度转币；不会自动给银行增加授权。
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice 新部署的幂等银行；原 TokenBank 部署与余额不受影响。
contract IdempotentTokenBank {
    IIdempotentToken public immutable token;
    mapping(address => uint256) public balances;
    // 地址隔离不同用户；编号对应操作内容的哈希，不是交易哈希或代币余额。
    mapping(address => mapping(bytes32 => bytes32)) public operationHash;
    bool private entered;

    event OperationExecuted(address indexed user, bytes32 indexed operationId, bool deposit, uint256 amount);

    /// @notice 固定代币地址；本银行另开自己的账本，不迁移旧银行中的存款。
    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IIdempotentToken(tokenAddress);
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
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
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
