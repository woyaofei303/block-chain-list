// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    /// @notice 从调用方转出最小单位 Token，返回 false 表示失败。
    function transfer(address to, uint256 amount) external returns (bool);
    /// @notice 消耗 from 对调用方的授权并转账，返回 false 表示失败。
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice 用于本项目 BaseERC20，按无手续费、无 rebase 的代币记账。
contract TokenBank {
    // 部署时固定 Token 地址，之后不能更换。
    IERC20 public immutable token;
    // 当前可提余额 = 存入 - 个人提款 - 自动划转分摊，单位为 Token 最小单位。
    mapping(address => uint256) public balances;
    // 自动划转只允许部署者配置的 Receiver 或部署者自己触发。
    address public owner;
    address public automationReceiver;
    // 所有用户当前可提余额之和；直接转入银行的 Token 不计入这里。
    uint256 public totalDeposits;
    address[] private depositors;
    mapping(address => bool) private knownDepositor;
    bool private entered;
    // ponytail: 教学版最多 100 个历史存款人，限制 O(n) 划转 gas；大规模应改为份额记账。
    uint256 public constant MAX_DEPOSITORS = 100;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event AutomationReceiverUpdated(address indexed receiver);
    event HalfWithdrawn(address indexed recipient, uint256 amount);

    /// @notice 绑定 Token 并记录银行管理员。
    /// @param tokenAddress 兼容 ERC20 transfer / transferFrom 的代币地址。
    constructor(address tokenAddress) {
        require(tokenAddress.code.length > 0, "Invalid token");
        token = IERC20(tokenAddress);
        owner = msg.sender;
    }

    /// @notice 设置能够被 CRE Receiver 使用的自动化调用地址。
    /// @dev 只接受合约地址，防止误把普通钱包配置成自动化入口。
    function setAutomationReceiver(address receiver) external onlyOwner {
        require(receiver.code.length > 0, "Invalid receiver");
        automationReceiver = receiver;
        emit AutomationReceiverUpdated(receiver);
    }

    /// @notice 用户先 approve 本银行后存入 Token，并增加个人与全行可提余额。
    /// @param amount Token 最小单位数量，必须大于零。
    function deposit(uint256 amount) external {
        _enter();
        require(amount > 0, "Amount must be positive");
        // Token 看到的调用者是银行，使用的是用户授权给银行的额度。
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        if (!knownDepositor[msg.sender]) {
            require(depositors.length < MAX_DEPOSITORS, "Depositor limit");
            knownDepositor[msg.sender] = true;
            depositors.push(msg.sender);
        }
        balances[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposited(msg.sender, amount);
        _exit();
    }

    /// @notice 提取调用者自己的存款。
    /// @param amount Token 最小单位数量，不能超过调用者可提余额。
    function withdraw(uint256 amount) external {
        _enter();
        require(amount > 0, "Amount must be positive");
        // 只能提取调用者自己的存款。
        require(balances[msg.sender] >= amount, "Insufficient deposited balance");
        // 先扣账再转币；转账失败时扣账也会回滚。
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        require(token.transfer(msg.sender, amount), "Token transfer failed");
        emit Withdrawn(msg.sender, amount);
        _exit();
    }

    /// @notice 将已记账存款的一半划转给指定地址，并按比例减少各用户可提余额。
    /// @dev 部署者或已配置 Receiver 可调用；直接转入银行的闲置 Token 不参与计算。
    /// @param recipient 接收半额 Token 的地址，不能为零地址。
    /// @return amount 实际划转的 Token 数量，采用整数除法向下取整。
    function withdrawhalf(address recipient) external onlyOwnerOrAutomation returns (uint256 amount) {
        _enter();
        require(recipient != address(0) && recipient != address(this), "Invalid recipient");

        uint256 depositsBefore = totalDeposits;
        amount = depositsBefore / 2;
        require(amount > 0, "No half to withdraw");

        // 每人扣一半；相邻的两个奇数余额共多扣一个最小单位，避免乘法溢出。
        // 任一用户的扣款与其半额之差不超过一个最小单位，总扣款恰为 floor(total/2)。
        uint256 carry;
        for (uint256 i = 0; i < depositors.length; i++) {
            address user = depositors[i];
            uint256 userBalance = balances[user];
            carry += userBalance % 2;
            balances[user] = userBalance - userBalance / 2 - carry / 2;
            carry %= 2;
        }
        totalDeposits = depositsBefore - amount;
        require(token.transfer(recipient, amount), "Token transfer failed");
        emit HalfWithdrawn(recipient, amount);
        _exit();
    }

    /// @notice 将管理员权限转移给新的非零地址。
    /// @param newOwner 新管理员地址。
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    /// @dev 限制配置操作只能由当前管理员执行。
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// @dev 允许管理员或已配置的 CRE Receiver 执行半额划转。
    modifier onlyOwnerOrAutomation() {
        require(msg.sender == owner || msg.sender == automationReceiver, "Not authorized");
        _;
    }

    /// @dev 保护 transferFrom / transfer 外部调用期间的余额账本，避免恶意 Token 重入。
    function _enter() private {
        require(!entered, "Reentrancy");
        entered = true;
    }

    /// @dev 在本函数所有外部 Token 调用完成后解除重入锁。
    function _exit() private {
        entered = false;
    }
}
