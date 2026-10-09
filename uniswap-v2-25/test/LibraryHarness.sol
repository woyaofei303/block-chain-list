// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.6.6;

import {UniswapV2Library} from "../src/periphery/libraries/UniswapV2Library.sol";

/// @notice 仅供测试跨编译器调用真实 Library，避免在测试中复制其哈希。
contract LibraryHarness {
    /// @notice 使用路由实际依赖的 Library 预测地址；任一哈希错误都会体现在返回值中。
    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address) {
        return UniswapV2Library.pairFor(factory, tokenA, tokenB);
    }
}
