// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {MyToken} from "../src/MyToken.sol";
import {FlashSwap} from "../src/FlashSwap.sol";

/// @notice 故意少还 1 wei B，验证原版 Pair 会在回调结束后拒绝交易。
contract Underpay {
    IERC20 immutable tokenB;
    IUniswapV2Pair immutable pool;
    uint256 immutable repayment;

    /// @notice 固定测试池、还款币和故意不足的还款额，不用于实际部署。
    constructor(IERC20 b, IUniswapV2Pair pair, uint256 amount) {
        tokenB = b;
        pool = pair;
        repayment = amount;
    }

    /// @notice 仅测试池可调用，借出的 A 留在本合约，仅偿还预定 B。
    function uniswapV2Call(address, uint256, uint256, bytes calldata) external {
        require(msg.sender == address(pool), "wrong pool");
        require(tokenB.transfer(address(pool), repayment), "repay failed");
    }
}

contract FlashSwapTest is Test {
    MyToken tokenA;
    MyToken tokenB;
    IUniswapV2Factory factoryA;
    IUniswapV2Factory factoryB;
    IUniswapV2Pair poolA;
    IUniswapV2Pair poolB;
    FlashSwap arb;

    /// @notice 每例建立实际 V2 池和独立储备；默认 A 地址较小，另有专门测试反向顺序。
    function setUp() public {
        vm.warp(1000);
        _markets(true);
    }

    /// @notice 按指定地址顺序分配两种 MyToken，并让两个独立 Factory 分别建立同币对池。
    function _markets(bool aFirst) internal {
        MyToken x = new MyToken("MyToken X", "MTX");
        MyToken y = new MyToken("MyToken Y", "MTY");
        (tokenA, tokenB) = (address(x) < address(y)) == aFirst ? (x, y) : (y, x);
        string memory artifact = "../output-tdd/uniswap-v2-25/out/UniswapV2Factory.sol/UniswapV2Factory.json";
        factoryA = IUniswapV2Factory(deployCode(artifact, abi.encode(address(this))));
        factoryB = IUniswapV2Factory(deployCode(artifact, abi.encode(address(this))));
        poolA = IUniswapV2Pair(factoryA.createPair(address(tokenA), address(tokenB)));
        poolB = IUniswapV2Pair(factoryB.createPair(address(tokenA), address(tokenB)));
        _seed(poolA, 20_000 ether);
        _seed(poolB, 30_000 ether);
        arb = new FlashSwap(address(factoryA), address(factoryB), address(tokenA), address(tokenB));
    }

    /// @notice 直接转双币后 mint LP；这与 Router 加池到 Pair 的资产流一致。
    function _seed(IUniswapV2Pair pair, uint256 amountB) internal {
        assertTrue(tokenA.transfer(address(pair), 10_000 ether));
        assertTrue(tokenB.transfer(address(pair), amountB));
        assertGt(pair.mint(address(this)), 0);
    }

    /// @notice 记录两池、策略与持有人的余额和储备，用于证明失败后完整回滚。
    function _stateHash() internal view returns (bytes32) {
        (uint112 a0, uint112 a1, uint32 at) = poolA.getReserves();
        (uint112 b0, uint112 b1, uint32 bt) = poolB.getReserves();
        bytes32 reserves = keccak256(abi.encode(a0, a1, at, b0, b1, bt));
        bytes32 pools = keccak256(
            abi.encode(
                tokenA.balanceOf(address(poolA)),
                tokenB.balanceOf(address(poolA)),
                tokenA.balanceOf(address(poolB)),
                tokenB.balanceOf(address(poolB))
            )
        );
        bytes32 accounts = keccak256(
            abi.encode(
                tokenA.balanceOf(address(arb)),
                tokenB.balanceOf(address(arb)),
                tokenA.balanceOf(address(this)),
                tokenB.balanceOf(address(this))
            )
        );
        return keccak256(abi.encode(reserves, pools, accounts));
    }

    /// @notice 检查固定发行、精度与独立池，防止两池误用同一 Factory。
    function testTokensAndPools() public view {
        assertEq(tokenA.totalSupply(), 1_000_000 ether);
        assertEq(tokenB.totalSupply(), 1_000_000 ether);
        assertEq(tokenA.decimals(), 18);
        assertEq(tokenB.decimals(), 18);
        assertTrue(address(poolA) != address(poolB));
        assertEq(poolA.factory(), address(factoryA));
        assertEq(poolB.factory(), address(factoryB));
        assertEq(arb.owner(), address(this));
    }

    /// @notice 从零策略余额完成 100 A 闪电兑换；检查精确利润、双池资产及含手续费前的 K 增长。
    function testFlashSwapWithoutCapital() public {
        _assertSwap(100 ether);
    }

    /// @notice A 是 token1 时仍只借 A、还 B，不能把储备顺序写死。
    function testTokenAIsToken1() public {
        _markets(false);
        assertFalse(arb.aIsToken0());
        _assertSwap(100 ether);
    }

    /// @notice 在仍有利润的输入区间随机验证手续费、舍入和资产守恒。
    function testFuzzProfitableBorrow(uint96 rawAmount) public {
        _assertSwap(bound(uint256(rawAmount), 0.001 ether, 200 ether));
    }

    /// @notice 对一笔成功交易逐项核验公式、余额和事件，且部署者无需转出 A。
    function _assertSwap(uint256 amountA) internal {
        uint256 repay = 20_000 ether * amountA * 1000 / ((10_000 ether - amountA) * 997) + 1;
        uint256 received = amountA * 997 * 30_000 ether / (10_000 ether * 1000 + amountA * 997);
        (uint256 quotedRepay, uint256 quotedReceived) = arb.quote(amountA);
        assertEq(quotedRepay, repay);
        assertEq(quotedReceived, received);
        uint256 beforeA = tokenA.balanceOf(address(this));
        uint256 beforeB = tokenB.balanceOf(address(this));
        vm.expectEmit(true, false, false, true, address(arb));
        emit FlashSwap.FlashSwapExecuted(address(this), amountA, received, repay, received - repay);
        arb.execute(amountA, received - repay, block.timestamp);
        assertEq(tokenA.balanceOf(address(this)), beforeA);
        assertEq(tokenB.balanceOf(address(this)) - beforeB, received - repay);
        assertEq(tokenA.balanceOf(address(arb)), 0);
        assertEq(tokenB.balanceOf(address(arb)), 0);
        assertEq(tokenA.balanceOf(address(poolA)), 10_000 ether - amountA);
        assertEq(tokenB.balanceOf(address(poolA)), 20_000 ether + repay);
        assertEq(tokenA.balanceOf(address(poolB)), 10_000 ether + amountA);
        assertEq(tokenB.balanceOf(address(poolB)), 30_000 ether - received);
        (uint112 a0, uint112 a1,) = poolA.getReserves();
        (uint112 b0, uint112 b1,) = poolB.getReserves();
        assertGt(uint256(a0) * a1, 10_000 ether * 20_000 ether);
        assertGt(uint256(b0) * b1, 10_000 ether * 30_000 ether);
    }

    /// @notice 无授权账户不能借助策略领取利润。
    function testOnlyOwner() public {
        bytes32 beforeState = _stateHash();
        vm.prank(address(0xBEEF));
        vm.expectRevert("only owner");
        arb.execute(100 ether, 0, block.timestamp);
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 外部账户伪造回调不能转走合约内已有代币。
    function testRejectForgedCallback() public {
        assertTrue(tokenA.transfer(address(arb), 100 ether));
        bytes32 beforeState = _stateHash();
        vm.expectRevert("only PoolA");
        arb.uniswapV2Call(address(arb), 100 ether, 0, abi.encode(uint256(0)));
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 攻击者直接调用真实 Pair 时 msg.sender 虽合法，回调 sender 不符仍整笔回滚。
    function testRejectThirdPartyInitiatedSwap() public {
        bytes32 beforeState = _stateHash();
        vm.expectRevert("invalid sender");
        poolA.swap(100 ether, 0, address(arb), abi.encode(uint256(0)));
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 回调拒绝借错币、双币同时借出以及零借款。
    function testRejectWrongCallbackAmounts() public {
        vm.startPrank(address(poolA));
        vm.expectRevert("borrow A only");
        arb.uniswapV2Call(address(arb), 0, 100 ether, abi.encode(uint256(0)));
        vm.expectRevert("borrow A only");
        arb.uniswapV2Call(address(arb), 100 ether, 1, abi.encode(uint256(0)));
        vm.expectRevert("borrow A only");
        arb.uniswapV2Call(address(arb), 0, 0, abi.encode(uint256(0)));
        vm.stopPrank();
    }

    /// @notice 零借款和抽空储备均在任何转账前拒绝。
    function testInvalidBorrowAmounts() public {
        vm.expectRevert("invalid borrow amount");
        arb.execute(0, 0, block.timestamp);
        vm.expectRevert("invalid borrow amount");
        arb.execute(10_000 ether, 0, block.timestamp);
        vm.expectRevert("invalid borrow amount");
        arb.execute(type(uint256).max, 0, block.timestamp);
    }

    /// @notice 到期与高一 wei 的利润要求都必须失败，资产不能变化。
    function testDeadlineAndMinimumProfit() public {
        bytes32 beforeState = _stateHash();
        vm.expectRevert("expired");
        arb.execute(100 ether, 0, block.timestamp - 1);
        (uint256 repay, uint256 received) = arb.quote(100 ether);
        vm.expectRevert("insufficient profit");
        arb.execute(100 ether, received - repay + 1, block.timestamp);
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 把 PoolA 调成与 PoolB 同价，即使策略已有 B 也不能拿存量补贴手续费亏损。
    function testNoSpreadCannotSpendDonations() public {
        assertTrue(tokenB.transfer(address(poolA), 10_000 ether));
        poolA.sync();
        assertTrue(tokenB.transfer(address(arb), 1000 ether));
        bytes32 beforeState = _stateHash();
        vm.expectRevert("insufficient profit");
        arb.execute(100 ether, 0, block.timestamp);
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 成功套利只分配本次利润，不会把误转入的余额当成额外利润。
    function testDonatedBalancesStayUntouched() public {
        assertTrue(tokenA.transfer(address(arb), 7 ether));
        assertTrue(tokenB.transfer(address(arb), 11 ether));
        uint256 beforeB = tokenB.balanceOf(address(this));
        (uint256 repay, uint256 received) = arb.quote(100 ether);
        arb.execute(100 ether, 0, block.timestamp);
        assertEq(tokenA.balanceOf(address(arb)), 7 ether);
        assertEq(tokenB.balanceOf(address(arb)), 11 ether);
        assertEq(tokenB.balanceOf(address(this)) - beforeB, received - repay);
    }

    /// @notice 在 PoolB 已兑换且已还款后模拟利润转账失败，两个池和所有相关余额必须全部恢复。
    function testCallbackFailureRollsBackBothPools() public {
        (uint256 repay, uint256 received) = arb.quote(100 ether);
        vm.mockCall(
            address(tokenB), abi.encodeCall(IERC20.transfer, (address(this), received - repay)), abi.encode(false)
        );
        bytes32 beforeState = _stateHash();
        vm.expectRevert("profit transfer failed");
        arb.execute(100 ether, 0, block.timestamp);
        assertEq(_stateHash(), beforeState);
    }

    /// @notice 真实 Pair 验证偿还公式的加一不可省略；少还最小单位会触发 K 检查并退回所有资产。
    function testOneWeiUnderpaymentFailsK() public {
        (uint256 repay,) = arb.quote(100 ether);
        Underpay bad = new Underpay(tokenB, poolA, repay - 1);
        assertTrue(tokenB.transfer(address(bad), repay - 1));
        bytes32 beforeState = _stateHash();
        vm.expectRevert("UniswapV2: K");
        poolA.swap(100 ether, 0, address(bad), hex"01");
        assertEq(_stateHash(), beforeState);
        assertEq(tokenB.balanceOf(address(bad)), repay - 1);
        assertEq(tokenA.balanceOf(address(bad)), 0);
    }

    /// @notice 部署时拒绝同一 Factory、同币对与尚未创建的池。
    function testInvalidConfiguration() public {
        vm.expectRevert("same factory");
        new FlashSwap(address(factoryA), address(factoryA), address(tokenA), address(tokenB));
        vm.expectRevert("invalid tokens");
        new FlashSwap(address(factoryA), address(factoryB), address(tokenA), address(tokenA));
        MyToken other = new MyToken("Other", "OTHER");
        vm.expectRevert("invalid pools");
        new FlashSwap(address(factoryA), address(factoryB), address(tokenA), address(other));
    }
}
