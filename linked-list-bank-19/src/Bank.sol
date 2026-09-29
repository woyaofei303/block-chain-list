// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice 接收 ETH、记录累计存款，并用可迭代单链表保存前 10 名。
/// @dev 沿用 Bank 练习的管理员统一提款规则；累计存款不是个人可提余额。
contract Bank {
    uint256 public constant MAX_TOP = 10;
    address public immutable admin;
    // 所有存款人的累计金额（Wei），落榜和管理员提款都不清零。
    mapping(address => uint256) public deposits;
    // 零地址是哨兵：next[0] 指向第一名，尾节点的 next 为 0。
    mapping(address => address) public next;
    uint256 public size;
    bool private withdrawing;

    event Deposited(address indexed depositor, uint256 amount, uint256 cumulativeAmount);
    event Withdrawn(address indexed admin, uint256 amount);

    /// @notice 部署者成为固定管理员，只有该地址能提取合约实际余额。
    constructor() {
        admin = msg.sender;
    }

    /// @notice 接收钱包发送的 ETH；调用数据须为空，金额须大于零。
    receive() external payable {
        _deposit();
    }

    /// @notice 显式存款入口，按 msg.sender 记账，msg.value 的单位为 Wei。
    function deposit() external payable {
        _deposit();
    }

    /// @notice 沿链表返回全部榜内用户，最多 10 人，不足时只返回实际人数。
    /// @return accounts 按累计存款降序排列的地址。
    /// @return amounts 与地址一一对应的累计金额，单位 Wei。
    function getTop10() external view returns (address[] memory accounts, uint256[] memory amounts) {
        accounts = new address[](size);
        amounts = new uint256[](size);
        address current = next[address(0)];
        for (uint256 i; i < size; i++) {
            accounts[i] = current;
            amounts[i] = deposits[current];
            current = next[current];
        }
    }

    /// @notice 仅管理员可提走全部实际余额；空余额、重入或收款失败时回滚。
    /// @dev 提款不修改累计存款和链表；先上锁再外部转账，失败会连同锁一起回滚。
    function withdraw() external {
        require(msg.sender == admin, "Only admin");
        require(!withdrawing, "Reentrant withdrawal");
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to withdraw");

        withdrawing = true;
        (bool success,) = payable(admin).call{value: amount}("");
        require(success, "Withdrawal failed");
        withdrawing = false;
        emit Withdrawn(admin, amount);
    }

    /// @dev 两个入口共用校验和记账；内部调用保留原调用者和本次金额。
    function _deposit() private {
        require(msg.value > 0, "Deposit must be positive");
        // 本次只有调用者的累计金额增加，其他用户的相对顺序不变。
        deposits[msg.sender] += msg.value;
        _updateTop10(msg.sender);
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    /// @dev 摘下已有节点后按新金额插入，超出 10 人则剪掉尾节点；不遍历全部存款人。
    /// @param user 本次存款人；其累计金额已经更新，真实交易发送者不可能为零地址。
    function _updateTop10(address user) private {
        address previous;
        // 哨兵也可充当前驱，因此删除第一名和其他节点使用相同操作。
        while (next[previous] != address(0) && next[previous] != user) {
            previous = next[previous];
        }
        if (next[previous] == user) {
            next[previous] = next[user];
            delete next[user];
            size--;
        }

        previous = address(0);
        uint256 position;
        // 越过所有金额 >= 当前用户的节点，使同额的已有成员保持在前。
        while (next[previous] != address(0) && deposits[next[previous]] >= deposits[user]) {
            previous = next[previous];
            position++;
        }
        // 已有 10 人不低于当前用户时，保留其存款记录但不插入链表。
        if (position == MAX_TOP) return;

        // 先保存后继，再接上前驱，避免丢失链表剩余部分。
        next[user] = next[previous];
        next[previous] = user;
        size++;

        if (size > MAX_TOP) {
            address last = address(0);
            for (uint256 i; i < MAX_TOP; i++) {
                last = next[last];
            }
            // last 是第 10 名；清理第 11 名的链接，不删除其累计金额。
            address evicted = next[last];
            delete next[last];
            delete next[evicted];
            size--;
        }
    }
}
