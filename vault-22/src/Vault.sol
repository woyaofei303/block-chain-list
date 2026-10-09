// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VaultLogic {
    /// @notice 逻辑合约自身的 owner；被 delegatecall 时会映射到调用方 slot 0。
    address public owner;
    /// @notice 逻辑合约的密码槽；被 delegatecall 时实际读取调用方 slot 1。
    bytes32 private password;

    /// @notice 初始化逻辑合约的 owner 和密码。
    /// @param _password 题目使用的密码，示例中不是安全的秘密。
    constructor(bytes32 _password) public {
        owner = msg.sender;
        password = _password;
    }

    /// @notice 密码匹配时修改 owner；Vault 的 fallback 会把它暴露为代理调用。
    /// @param _password 待校验的密码。
    /// @param newOwner 新 owner 地址。
    function changeOwner(bytes32 _password, address newOwner) public {
        if (password == _password) {
            owner = newOwner;
        } else {
            revert("password error");
        }
    }
}

contract Vault {
    /// @notice Vault 管理员；提款开关只比较这个地址。
    address public owner;
    /// @notice 被 fallback 委托调用的逻辑合约地址。
    VaultLogic logic;
    /// @notice 每个地址在 Vault 中登记的存款金额。
    mapping(address => uint256) deposites;
    /// @notice 管理员开启后，存款人才能进入提款分支。
    bool public canWithdraw = false;

    /// @notice 记录逻辑合约并设置部署者为 Vault owner。
    /// @param _logicAddress 逻辑合约地址；题目未校验其代码和存储布局。
    constructor(address _logicAddress) public {
        logic = VaultLogic(_logicAddress);
        owner = msg.sender;
    }

    /// @notice 将任意 calldata 委托给逻辑合约；这是题目的 delegatecall 漏洞入口。
    fallback() external {
        // 执行 Logic 的代码，却读写 Vault 的槽：Logic 的 password 槽在这里存的是 logic 地址。
        // 因此比较的不是构造 Logic 时传入的秘密，而是这个公开地址对应的 32 字节值。
        (bool result,) = address(logic).delegatecall(msg.data);
        if (result) {
            this;
        }
    }

    /// @notice 接收未带 calldata 的 ETH，但不会增加任何地址的存款记录。
    receive() external payable {}

    /// @notice 为调用者累计记录 ETH 存款。
    /// @dev 题目中的提款逻辑会在外部调用之后才清零该记录。
    function deposite() public payable {
        deposites[msg.sender] += msg.value;
    }

    /// @notice 判断 Vault 当前余额是否已归零。
    /// @return solved 余额为零时为 true，其他路径依赖 Solidity 默认 false。
    function isSolve() external view returns (bool) {
        if (address(this).balance == 0) {
            return true;
        }
    }

    /// @notice 仅 owner 能开启所有存款人的提款分支。
    function openWithdraw() external {
        if (owner == msg.sender) {
            canWithdraw = true;
        } else {
            revert("not owner");
        }
    }

    /// @notice 向调用者发送其登记余额；题目故意保留外部调用前未清零的重入缺陷。
    function withdraw() public {
        if (canWithdraw && deposites[msg.sender] >= 0) {
            (bool result,) = msg.sender.call{value: deposites[msg.sender]}("");
            if (result) {
                deposites[msg.sender] = 0;
            }
        }
    }
}
