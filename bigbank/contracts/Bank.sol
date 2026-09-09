// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// ETH 存款练习：记录累计存款和前三名，由管理员统一提取合约余额。
// 这里的 deposits 是历史记录，用户没有按个人记录自行提款的接口。
contract Bank {
    // 本练习允许派生合约转移管理员；public 自动生成 admin() 查询接口。
    address public admin;

    // 地址 => 历史累计存款，单位 Wei。未存过款的地址默认返回 0。
    mapping(address => uint256) public deposits;

    // 按累计金额降序保存地址；下标 0 是第一名，空位用 address(0) 表示。
    // 金额统一从 deposits 读取，避免维护两份金额数据。
    address[3] public top3;

    // 提款转账可能执行管理员合约的收款回调，锁用于阻止回调再次提款。
    bool private withdrawing;

    // 事件供交易回执和外部程序查看；indexed 便于按地址筛选记录。
    event Deposited(address indexed depositor, uint256 amount, uint256 cumulativeAmount);
    event Withdrawn(address indexed admin, uint256 amount);

    modifier onlyAdmin() {
        // require(msg.sender == admin, "Only admin");
        if (msg.sender != admin) {
            revert("Only admin");
        }
        _;
    }

    // 构造函数只在部署时运行一次。msg.sender 是直接创建 Bank 的钱包或合约。
    constructor() {
        admin = msg.sender;
    }

    // 空调用数据的 ETH 转账进入这里，例如 MetaMask 直接向合约地址转账。
    receive() external payable {
        _deposit();
    }

    // 显式存款入口：在 Remix 设置 Value 后调用；payable 允许附带 ETH。
    function deposit() external payable {
        _deposit();
    }

    // 一次查询全部名次与金额；两个数组相同下标对应同一个人。
    // memory 是本次调用的临时副本，view 表示此函数不修改链上状态。
    function getTop3() external view returns (address[3] memory accounts, uint256[3] memory amounts) {
        accounts = top3;
        for (uint256 i = 0; i < 3; i++) {
            amounts[i] = deposits[accounts[i]];
        }
    }

    // 仅管理员可提取调用时的全部实际余额；调用时不要附带 ETH。
    function withdraw() external onlyAdmin {
        require(!withdrawing, "Reentrant withdrawal");
        // 历史累计金额不会随提款减少，因此不能用 deposits 计算可提取金额。
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to withdraw");
        // 保存本次收款人，避免收款回调转移管理员后事件指向其他地址。
        address recipient = admin;

        // 先上锁再进行外部调用；管理员若是合约，其收款代码会在 call 中执行。
        withdrawing = true;
        (bool success,) = payable(recipient).call{value: amount}("");
        // 低级 call 用布尔值报告失败；require 让本次提款回滚，锁也恢复原值。
        require(success, "Withdrawal failed");
        withdrawing = false;

        // 提款后保留 deposits 和 top3，后续存款继续累计。
        emit Withdrawn(recipient, amount);
    }

    // 两个入口共用记账流程，内部调用保留原来的 msg.sender 和 msg.value。
    function _deposit() internal virtual {
        require(msg.value > 0, "Deposit must be positive");
        // msg.value 是本次调用附带的 Wei；先累加，再用最新总额更新排名。
        deposits[msg.sender] += msg.value;
        _updateTop3();
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    // 本次只有存款人的金额增加，其他人的相对顺序不变，只需调整这个地址。
    function _updateTop3() private {
        uint256 index;
        // 先查找已有位置，避免同一地址重复入榜；index == 3 表示不在榜内。
        while (index < 3 && top3[index] != msg.sender) {
            index++;
        }

        if (index == 3) {
            // 榜外地址必须严格超过第三名；相等时保留原第三名。
            // 未满三人时尾部为空地址，其累计金额为 0，正数存款自然可以入榜。
            if (deposits[msg.sender] <= deposits[top3[2]]) return;
            index = 2;
            top3[index] = msg.sender;
        }

        // 从已有位置或第三位向前移动：超过前一名才换位，同额不越过前人。
        // 每轮把前一名后移一格，再把存款人放入空出的位置，最多前移两次。
        while (index > 0 && deposits[msg.sender] > deposits[top3[index - 1]]) {
            top3[index] = top3[index - 1];
            index--;
            top3[index] = msg.sender;
        }
    }
}
