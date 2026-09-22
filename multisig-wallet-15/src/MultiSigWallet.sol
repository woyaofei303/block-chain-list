// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice 固定持有人与门槛，通过链上交易确认提案的简单多签钱包。
contract MultiSigWallet {
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 numConfirmations;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable required;
    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;

    event Deposit(address indexed sender, uint256 amount);
    event SubmitTransaction(address indexed owner, uint256 indexed txId, address indexed to, uint256 value, bytes data);
    event ConfirmTransaction(address indexed owner, uint256 indexed txId);
    event ExecuteTransaction(address indexed executor, uint256 indexed txId);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier pendingTransaction(uint256 txId) {
        require(txId < transactions.length, "Transaction does not exist");
        require(!transactions[txId].executed, "Transaction already executed");
        _;
    }

    constructor(address[] memory initialOwners, uint256 requiredConfirmations) {
        require(initialOwners.length > 0, "Owners required");
        require(
            requiredConfirmations > 0 && requiredConfirmations <= initialOwners.length, "Invalid confirmation threshold"
        );

        for (uint256 i; i < initialOwners.length; i++) {
            address owner = initialOwners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
        }
        required = requiredConfirmations;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice 提交固定的目标、ETH 金额（Wei）与调用数据，不自动计为确认。
    function submitTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 txId)
    {
        require(to != address(0), "Invalid destination");
        txId = transactions.length;
        transactions.push(Transaction({to: to, value: value, data: data, executed: false, numConfirmations: 0}));
        emit SubmitTransaction(msg.sender, txId, to, value, data);
    }

    /// @notice 包括提案人在内的每位持有人，都需显式确认，且同一提案只能确认一次。
    function confirmTransaction(uint256 txId) external onlyOwner pendingTransaction(txId) {
        require(!isConfirmed[txId][msg.sender], "Already confirmed");
        isConfirmed[txId][msg.sender] = true;
        transactions[txId].numConfirmations++;
        emit ConfirmTransaction(msg.sender, txId);
    }

    /// @notice 达到门槛后，任何人都可触发执行；支出来自钱包余额。
    function executeTransaction(uint256 txId) external pendingTransaction(txId) {
        Transaction storage transaction = transactions[txId];
        require(transaction.numConfirmations >= required, "Not enough confirmations");
        require(address(this).balance >= transaction.value, "Insufficient balance");

        // 先标记再外部调用，防止同一提案重入执行；调用失败时整笔交易回滚，可重试。
        transaction.executed = true;
        (bool success,) = transaction.to.call{value: transaction.value}(transaction.data);
        require(success, "Transaction call failed");
        emit ExecuteTransaction(msg.sender, txId);
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }
}
