// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TokenBank} from "../src/TokenBank.sol";

interface ForkVm {
    function createSelectFork(string calldata rpcUrl, uint256 blockNumber) external returns (uint256 forkId);
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function prank(address msgSender) external;
}

interface IUSDT {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract TokenBankUSDTSepoliaForkTest {
    ForkVm private constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    IUSDT private constant USDT = IUSDT(0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0);
    address private constant USDT_HOLDER = 0xBBFB60a1d4e16c932B1546C9136AAd0D89f9f834;
    address private constant ALICE = address(0xA11CE);
    uint256 private constant FORK_BLOCK = 11_706_800;
    uint256 private constant DEPOSIT_AMOUNT = 1_000e6;

    TokenBank private bank;

    function setUp() public {
        string memory rpcUrl = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        vm.createSelectFork(rpcUrl, FORK_BLOCK);
        require(block.chainid == 11_155_111, "fork is not Sepolia");
        require(keccak256(bytes(USDT.symbol())) == keccak256("USDT"), "token is not USDT");
        require(USDT.decimals() == 6, "unexpected USDT decimals");

        bank = new TokenBank(address(USDT));
        vm.prank(USDT_HOLDER);
        require(USDT.transfer(ALICE, DEPOSIT_AMOUNT), "failed to fund test user");
    }

    function testSepoliaUSDTDepositAndWithdraw() public {
        require(USDT.balanceOf(ALICE) == DEPOSIT_AMOUNT, "test user did not receive USDT");

        vm.prank(ALICE);
        require(USDT.approve(address(bank), DEPOSIT_AMOUNT), "approval failed");
        vm.prank(ALICE);
        bank.deposit(DEPOSIT_AMOUNT);

        require(bank.balances(ALICE) == DEPOSIT_AMOUNT, "deposit was not credited");
        require(USDT.balanceOf(address(bank)) == DEPOSIT_AMOUNT, "bank did not receive USDT");

        vm.prank(ALICE);
        bank.withdraw(400e6);
        require(bank.balances(ALICE) == 600e6, "partial withdrawal was not debited");
        require(USDT.balanceOf(ALICE) == 400e6, "partial withdrawal did not return USDT");

        vm.prank(ALICE);
        bank.withdraw(600e6);
        require(bank.balances(ALICE) == 0, "full withdrawal did not clear the deposit");
        require(USDT.balanceOf(ALICE) == DEPOSIT_AMOUNT, "user did not recover all USDT");
        require(USDT.balanceOf(address(bank)) == 0, "bank retained USDT");
    }
}
