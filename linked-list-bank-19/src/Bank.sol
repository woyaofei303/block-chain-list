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
        // 人数在只读查询中不会变化，缓存后避免循环重复读取同一个存储槽。
        uint256 count = size;
        accounts = new address[](count);
        amounts = new uint256[](count);
        address current = next[address(0)];
        for (uint256 i = 0; i < count; i++) {
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
        uint256 amount = deposits[msg.sender] + msg.value;
        deposits[msg.sender] = amount;
        _updateTop10(msg.sender, amount);
        emit Deposited(msg.sender, msg.value, amount);
    }

    /// @dev 按新金额定位；名次不变直接返回，需要换位时才改链接，每个节点至多访问一次。
    /// @param user 本次非零存款人；累计金额只增不减，因此已有节点只可能前移。
    /// @param amount 已记入 deposits 的累计 Wei，复用局部值避免重复读取存储。
    function _updateTop10(address user, uint256 amount) private {
        address previous = address(0);
        address current = next[previous];
        // 先找插入位置，跳过同额用户。遇到自己意味着没有超过任何前人，无需摘下再插回。
        while (current != address(0) && current != user && deposits[current] >= amount) {
            previous = current;
            current = next[current];
        }
        if (current == user) return;

        if (current == address(0)) {
            // 走到末尾仍未遇到自己，说明在榜外。未满时追加；已满且同额/更低则不入榜。
            if (size < MAX_TOP) {
                next[previous] = user;
                size++;
            }
            return;
        }

        // 从插入位置继续向后找自己或尾节点，不再从头遍历。
        address scanPrevious = previous;
        address scan = current;
        address following = next[scan];
        while (following != address(0) && following != user) {
            scanPrevious = scan;
            scan = following;
            following = next[scan];
        }
        if (following == user) {
            // 榜内前移：只修改旧前驱，自己的链接随后直接覆盖；人数不变。
            next[scan] = next[user];
        } else if (size == MAX_TOP) {
            // 榜满时 scan 是要淘汰的尾节点，其 next 本来就是零，无需再清零。
            if (scan == current) {
                // 仅替换第 10 名时，榜外 user 的 next 也为零，只改前驱即可。
                next[previous] = user;
                return;
            }
            delete next[scanPrevious];
        } else {
            // 只有榜单未满且首次入榜，人数才真正增加。
            size++;
        }

        // current 是插入后的后继；先连后继再连前驱，已有节点不会重复或成环。
        next[user] = current;
        next[previous] = user;
    }
}
