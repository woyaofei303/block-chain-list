// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {esRNT} from "../src/esRNT.sol";

interface StorageVm {
    /// @notice 设置测试区块时间，使构造函数时间公式可确定地验证。
    function warp(uint256 timestamp) external;
    /// @notice 在测试 EVM 中读取指定合约的原始存储槽。
    function load(address target, bytes32 slot) external view returns (bytes32);
}

contract EsRNTTest {
    StorageVm private constant vm = StorageVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice 验证真实编译后的长度、两槽步长、三个字段与全部 11 项构造值。
    function testAllPrivateLocks() public {
        vm.warp(1_800_000_000);
        esRNT target = new esRNT();
        assert(uint256(vm.load(address(target), bytes32(0))) == 11);
        uint256 base = uint256(keccak256(abi.encode(uint256(0))));

        for (uint256 i = 0; i < 11; i++) {
            uint256 packed = uint256(vm.load(address(target), bytes32(base + i * 2)));
            // 地址在低 160 位；时间右移 160 位后截取 uint64，不能反向解码。
            assert(address(uint160(packed)) == address(uint160(i + 1)));
            assert(uint64(packed >> 160) == 3_600_000_000 - i);
            assert(uint256(vm.load(address(target), bytes32(base + i * 2 + 1))) == 1e18 * (i + 1));
        }
    }
}
