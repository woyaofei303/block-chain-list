// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenBank} from "../src/TokenBank.sol";

// 只声明 Sepolia fork 测试需要的 Foundry cheatcode，避免引入 forge-std。
interface ForkVm {
    // 从指定 RPC 和区块复制一份只在本机存在的链状态。
    function createSelectFork(string calldata rpcUrl, uint256 blockNumber) external returns (uint256 forkId);
    // 优先读取环境变量；未设置时使用公开 RPC。
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    // 仅修改下一次普通外部调用的 msg.sender。
    function prank(address msgSender) external;
}

// 测试只需要 Sepolia USDT 的这些公开方法。
interface IUSDT {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract TokenBankUSDTSepoliaForkTest {
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Aave V3 Sepolia 地址簿登记的 6 位精度 USDT 测试 Token。
    IUSDT private constant USDT = IUSDT(0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0);

    // 该地址在固定 fork 区块持有充足 USDT；prank 只在本地 fork 中模拟其身份。
    address private constant USDT_HOLDER = 0xBBFB60a1d4e16c932B1546C9136AAd0D89f9f834;
    address private constant ALICE = address(0xA11CE);

    // 固定区块让合约代码、持币余额和测试输入保持可复现。
    uint256 private constant FORK_BLOCK = 11_706_800;

    // USDT 有 6 位小数，所以 1_000e6 表示 1,000 USDT。
    uint256 private constant DEPOSIT_AMOUNT = 1_000e6;

    TokenBank private bank;

    // 每项测试开始前：创建 Sepolia fork、核对网络和 Token、部署 TokenBank、准备 Alice 的 USDT。
    function setUp() public {
        string memory rpcUrl = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        vm.createSelectFork(rpcUrl, FORK_BLOCK);

        // 防止 RPC 配错网络或 Token 地址指向了另一个合约。
        require(block.chainid == 11_155_111, "fork is not Sepolia");
        require(keccak256(bytes(USDT.symbol())) == keccak256("USDT"), "token is not USDT");
        require(USDT.decimals() == 6, "unexpected USDT decimals");

        // 新部署的 TokenBank 绑定上面的 Sepolia USDT 地址。
        bank = new TokenBank(address(USDT));

        // 在 fork 的临时状态中模拟持币人给 Alice 转 1,000 USDT，不会发送真实交易。
        vm.prank(USDT_HOLDER);
        require(USDT.transfer(ALICE, DEPOSIT_AMOUNT), "failed to fund test user");
    }

    // 完整验证 approve → deposit → 部分 withdraw → 全部 withdraw。
    function testSepoliaUSDTDepositAndWithdraw() public {
        // 第一步：确认 setUp 已给 Alice 准备好 1,000 USDT。
        require(USDT.balanceOf(ALICE) == DEPOSIT_AMOUNT, "test user did not receive USDT");

        // 第二步：Alice 先授权 TokenBank，授权本身不会移动 Token。
        vm.prank(ALICE);
        require(USDT.approve(address(bank), DEPOSIT_AMOUNT), "approval failed");

        // 第三步：Alice 存款；TokenBank 用 transferFrom 收币并增加内部 balances。
        vm.prank(ALICE);
        bank.deposit(DEPOSIT_AMOUNT);

        // 同时检查“内部记账”和“USDT 实际持仓”，两者必须一致。
        require(bank.balances(ALICE) == DEPOSIT_AMOUNT, "deposit was not credited");
        require(USDT.balanceOf(address(bank)) == DEPOSIT_AMOUNT, "bank did not receive USDT");

        // 第四步：Alice 取出 400 USDT，内部可提余额应剩 600，钱包收到 400。
        vm.prank(ALICE);
        bank.withdraw(400e6);
        require(bank.balances(ALICE) == 600e6, "partial withdrawal was not debited");
        require(USDT.balanceOf(ALICE) == 400e6, "partial withdrawal did not return USDT");

        // 第五步：取出剩余 600 USDT，Alice 恢复 1,000，TokenBank 的账和持仓都归零。
        vm.prank(ALICE);
        bank.withdraw(600e6);
        require(bank.balances(ALICE) == 0, "full withdrawal did not clear the deposit");
        require(USDT.balanceOf(ALICE) == DEPOSIT_AMOUNT, "user did not recover all USDT");
        require(USDT.balanceOf(address(bank)) == 0, "bank retained USDT");
    }
}
