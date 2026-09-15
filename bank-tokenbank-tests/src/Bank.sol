// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice 接收 ETH、记录每位用户的累计存款，并维护累计存款前三名。
/// @dev 普通用户只能存款；部署 Bank 的地址是管理员，只有管理员能提取合约内全部 ETH。
contract Bank {
    // immutable 表示部署完成后管理员地址不能再修改。
    address public immutable admin;

    // 用户地址 => 历史累计存入的 ETH 数量，单位是 Wei。
    // 管理员提款不会清零这里的历史数据。
    mapping(address => uint256) public deposits;

    // 按累计存款从高到低保存前三名。人数不足时，剩余位置为 address(0)。
    address[3] public top3;

    // 部署者成为管理员。测试中 BankTest 部署 Bank，所以 BankTest 是管理员。
    constructor() {
        admin = msg.sender;
    }

    // 用户直接向合约地址转 ETH、且 calldata 为空时进入 receive，再复用 deposit 的记账流程。
    receive() external payable {
        deposit();
    }

    /// @notice 存入随交易发送的 ETH，并按最新累计金额更新排行榜。
    function deposit() public payable {
        require(msg.value > 0, "Deposit must be positive");

        // 先累计本次金额，再用新累计值参与排名。
        deposits[msg.sender] += msg.value;
        _updateTop3(msg.sender);
    }

    /// @notice 管理员提取 Bank 当前持有的全部 ETH。
    function withdraw() external {
        require(msg.sender == admin, "Only admin");

        // call 会把全部余额发送给管理员；失败时整笔交易回滚。
        (bool success,) = payable(admin).call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }

    // 只有当前存款人的金额会增加，因此只需在三个榜位内移动这个地址。
    function _updateTop3(address depositor) private {
        uint256 index;

        // 先找 depositor 是否已经在榜。index == 3 表示三个位置都没找到。
        while (index < 3 && top3[index] != depositor) index++;

        if (index == 3) {
            // 榜外用户只有严格超过第三名才能入榜；相同金额保持原有顺序。
            // 榜单未满时，空地址的 deposits 为 0，任何正数存款都能进入。
            if (deposits[depositor] <= deposits[top3[2]]) return;

            // 先占据第三位，再在下面的循环中尝试向前移动。
            index = 2;
            top3[index] = depositor;
        }

        // 每次与前一名比较；金额更高就交换，最多移动两次。
        // 使用严格大于保证同额用户不会越过更早到达该名次的用户。
        while (index > 0 && deposits[depositor] > deposits[top3[index - 1]]) {
            top3[index] = top3[index - 1];
            index--;
            top3[index] = depositor;
        }
    }
}
