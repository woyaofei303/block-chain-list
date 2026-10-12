// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Callee} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol";

/// @notice 从 PoolA 借 A，在 PoolB 卖 A 得 B，用 B 偿还 PoolA，利润发给部署者。
/// @dev 仅支持本练习普通 ERC20 和标准 0.3% 手续费 V2 池；部署时信任指定的两个 Factory。
contract FlashSwap is IUniswapV2Callee {
    address public immutable owner;
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    IUniswapV2Pair public immutable poolA;
    IUniswapV2Pair public immutable poolB;
    bool public immutable aIsToken0;

    event FlashSwapExecuted(
        address indexed recipient, uint256 borrowedA, uint256 receivedB, uint256 repaidB, uint256 profitB
    );

    /// @notice 固定部署者、两币及已创建的两个池；相同 Factory、无池或不匹配的币对均拒绝。
    constructor(address factoryA, address factoryB, address tokenA_, address tokenB_) {
        require(factoryA != factoryB, "same factory");
        require(tokenA_ != address(0) && tokenB_ != address(0) && tokenA_ != tokenB_, "invalid tokens");
        address pairA = IUniswapV2Factory(factoryA).getPair(tokenA_, tokenB_);
        address pairB = IUniswapV2Factory(factoryB).getPair(tokenA_, tokenB_);
        require(pairA != address(0) && pairB != address(0) && pairA != pairB, "invalid pools");
        (address token0, address token1) = tokenA_ < tokenB_ ? (tokenA_, tokenB_) : (tokenB_, tokenA_);
        require(
            IUniswapV2Pair(pairA).token0() == token0 && IUniswapV2Pair(pairA).token1() == token1
                && IUniswapV2Pair(pairB).token0() == token0 && IUniswapV2Pair(pairB).token1() == token1,
            "wrong pair tokens"
        );
        owner = msg.sender;
        tokenA = IERC20(tokenA_);
        tokenB = IERC20(tokenB_);
        poolA = IUniswapV2Pair(pairA);
        poolB = IUniswapV2Pair(pairB);
        aIsToken0 = tokenA_ == token0;
    }

    /// @notice 根据当前储备报价，返回应还的 B 和 PoolB 的预期输出；报价不预留价差。
    /// @param amountA 借出的 A 最小单位数量，必须大于零且小于 PoolA 的 A 储备。
    function quote(uint256 amountA) public view returns (uint256 repayB, uint256 receiveB) {
        (uint256 reserveAA, uint256 reserveAB) = _reserves(poolA);
        (uint256 reserveBA, uint256 reserveBB) = _reserves(poolB);
        require(amountA > 0 && amountA < reserveAA, "invalid borrow amount");
        require(reserveAB > 0 && reserveBA > 0 && reserveBB > 0, "empty pool");
        // PoolA 是精确输出 A、输入 B；按 V2 getAmountIn 公式取整加一，不能只加 0.3% 的 A。
        repayB = reserveAB * amountA * 1000 / ((reserveAA - amountA) * 997) + 1;
        uint256 amountWithFee = amountA * 997;
        receiveB = amountWithFee * reserveBB / (reserveBA * 1000 + amountWithFee);
    }

    /// @notice 仅部署者可发起；到期、无利润或利润低于 minProfitB 时整笔回滚，无需预存币或授权。
    function execute(uint256 amountA, uint256 minProfitB, uint256 deadline) external {
        require(msg.sender == owner, "only owner");
        require(block.timestamp <= deadline, "expired");
        (uint256 repayB, uint256 receiveB) = quote(amountA);
        require(receiveB > repayB && receiveB - repayB >= minProfitB, "insufficient profit");
        // 非空 data 触发回调；这里的 sender 是本合约，原始 EOA 固定为 owner。
        poolA.swap(aIsToken0 ? amountA : 0, aIsToken0 ? 0 : amountA, address(this), abi.encode(minProfitB));
    }

    /// @notice 只接受 PoolA 对本合约发起的 swap 回调；函数名必须是小写开头的 uniswapV2Call。
    /// @dev 先卖 A，再用本次实际收到的 B 还款及分配利润；预存 B 不得掩盖亏损。
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external override {
        require(msg.sender == address(poolA), "only PoolA");
        require(sender == address(this), "invalid sender");
        uint256 amountA = aIsToken0 ? amount0 : amount1;
        require(amountA > 0 && (aIsToken0 ? amount1 : amount0) == 0, "borrow A only");
        uint256 minProfitB = abi.decode(data, (uint256));
        (uint256 repayB, uint256 receiveB) = quote(amountA);
        uint256 beforeB = tokenB.balanceOf(address(this));
        require(tokenA.transfer(address(poolB), amountA), "transfer A failed");
        // PoolB 的 data 为空：它收到 A 后正常兑换，不再发起第二层闪电回调。
        poolB.swap(aIsToken0 ? 0 : receiveB, aIsToken0 ? receiveB : 0, address(this), "");
        uint256 receivedB = tokenB.balanceOf(address(this)) - beforeB;
        require(receivedB > repayB && receivedB - repayB >= minProfitB, "insufficient profit");
        uint256 profitB = receivedB - repayB;
        require(tokenB.transfer(address(poolA), repayB), "repay failed");
        require(tokenB.transfer(owner, profitB), "profit transfer failed");
        emit FlashSwapExecuted(owner, amountA, receivedB, repayB, profitB);
        // 回调返回后 PoolA 才检查含手续费的 K；检查失败会连 PoolB 兑换和利润转账一起回滚。
    }

    /// @notice 将 Pair 的 token0/token1 储备转为策略中的 A/B 顺序；两个池的币对已在构造时核验。
    function _reserves(IUniswapV2Pair pair) internal view returns (uint256 reserveA, uint256 reserveB) {
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        return aIsToken0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }
}
