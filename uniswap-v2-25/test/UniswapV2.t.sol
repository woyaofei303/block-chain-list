// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IUniswapV2Factory} from "../src/core/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "../src/core/interfaces/IUniswapV2Pair.sol";
import {IERC20} from "../src/core/interfaces/IERC20.sol";
import {IUniswapV2Router02} from "../src/periphery/interfaces/IUniswapV2Router02.sol";

interface ILibraryHarness {
    /// @notice 跨版本读取真实周边库计算出的 CREATE2 地址。
    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address);
}

/// @notice 对真实 0.5/0.6 字节码执行集成行为测试；所有余额和签名都属于本地 EVM。
contract UniswapV2Test is Test {
    IUniswapV2Factory factory;
    IUniswapV2Router02 router;
    IUniswapV2Pair pair;
    IERC20 tokenA;
    IERC20 tokenB;
    address weth;
    uint256 constant RESERVE_A = 10_000 ether;
    uint256 constant RESERVE_B = 20_000 ether;

    /// @notice 每个测试部署独立合约和空池；旧版本实现只通过产物加载，避免 pragma 冲突。
    function setUp() public {
        vm.warp(1000);
        factory = IUniswapV2Factory(deployCode("UniswapV2Factory.sol:UniswapV2Factory", abi.encode(address(this))));
        weth = deployCode("WETH9.sol:WETH9");
        router = IUniswapV2Router02(
            deployCode("UniswapV2Router02.sol:UniswapV2Router02", abi.encode(address(factory), weth))
        );
        tokenA = IERC20(deployCode("ERC20.sol:ERC20", abi.encode(1_000_000 ether)));
        tokenB = IERC20(deployCode("ERC20.sol:ERC20", abi.encode(1_000_000 ether)));
        pair = IUniswapV2Pair(factory.createPair(address(tokenA), address(tokenB)));
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        vm.deal(address(this), 100 ether);
    }

    /// @notice 接收路由退回或解包的 ETH；仅供本地测试。
    receive() external payable {}

    /// @notice 注入固定双币储备，返回本测试获得的 LP；最小投入与期望投入完全相等。
    function _seed() internal returns (uint256 liquidity) {
        (,, liquidity) = router.addLiquidity(
            address(tokenA), address(tokenB), RESERVE_A, RESERVE_B, RESERVE_A, RESERVE_B, address(this), block.timestamp
        );
    }

    /// @notice 创建两币路径，保证测试可显式覆盖正向与反向兑换。
    function _path(address from, address to) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = from;
        path[1] = to;
    }

    /// @notice 验证 Library、实际 Factory 与直接创建字节码公式三者一致，捕获注释或配置导致的哈希漂移。
    function testPairForMatchesActualCreationCode() public {
        ILibraryHarness libraryHarness = ILibraryHarness(deployCode("LibraryHarness.sol:LibraryHarness"));
        bytes32 salt = keccak256(abi.encodePacked(pair.token0(), pair.token1()));
        bytes32 hash = keccak256(vm.getCode("UniswapV2Pair.sol:UniswapV2Pair"));
        address predicted =
            address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(factory), salt, hash)))));
        assertEq(predicted, address(pair));
        assertEq(libraryHarness.pairFor(address(factory), address(tokenA), address(tokenB)), predicted);
        assertEq(libraryHarness.pairFor(address(factory), address(tokenB), address(tokenA)), predicted);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), predicted);
        assertEq(factory.allPairsLength(), 1);
        assertEq(pair.factory(), address(factory));
    }

    /// @notice 同币、零地址及反向重复建池必须回滚，池数量不能变化。
    function testInvalidPairsRevert() public {
        vm.expectRevert("UniswapV2: IDENTICAL_ADDRESSES");
        factory.createPair(address(tokenA), address(tokenA));
        vm.expectRevert("UniswapV2: ZERO_ADDRESS");
        factory.createPair(address(0), address(tokenA));
        vm.expectRevert("UniswapV2: PAIR_EXISTS");
        factory.createPair(address(tokenB), address(tokenA));
        assertEq(factory.allPairsLength(), 1);
    }

    /// @notice 普通账户不能改手续费配置或重新初始化 Pair；移交管理权后旧管理员失权。
    function testAdministrativePermissions() public {
        vm.startPrank(address(0xBEEF));
        vm.expectRevert("UniswapV2: FORBIDDEN");
        factory.setFeeTo(address(0xBEEF));
        vm.expectRevert("UniswapV2: FORBIDDEN");
        factory.setFeeToSetter(address(0xBEEF));
        vm.expectRevert("UniswapV2: FORBIDDEN");
        pair.initialize(address(tokenB), address(tokenA));
        vm.stopPrank();
        factory.setFeeToSetter(address(0xBEEF));
        vm.expectRevert("UniswapV2: FORBIDDEN");
        factory.setFeeTo(address(this));
    }

    /// @notice 首次注入锁定 1000 最小 LP 单位；全部赎回用户 LP 后仍留下锁定份额与对应双币。
    function testMintAndBurnMinimumLiquidity() public {
        uint256 liquidity = _seed();
        assertEq(pair.balanceOf(address(0)), 1000);
        assertEq(pair.totalSupply(), liquidity + 1000);
        pair.approve(address(router), liquidity);
        uint256 balanceA = tokenA.balanceOf(address(this));
        uint256 balanceB = tokenB.balanceOf(address(this));
        (uint256 amountA, uint256 amountB) =
            router.removeLiquidity(address(tokenA), address(tokenB), liquidity, 1, 1, address(this), block.timestamp);
        assertEq(tokenA.balanceOf(address(this)) - balanceA, amountA);
        assertEq(tokenB.balanceOf(address(this)) - balanceB, amountB);
        assertEq(pair.totalSupply(), 1000);
        assertGt(tokenA.balanceOf(address(pair)), 0);
        assertGt(tokenB.balanceOf(address(pair)), 0);
    }

    /// @notice 后续添加流动性沿用 1:2 比例，不会转走用户提供但无需使用的多余 TokenB。
    function testAddLiquidityUsesOptimalRatio() public {
        _seed();
        (uint256 a, uint256 b,) = router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 300 ether, 100 ether, 200 ether, address(this), block.timestamp
        );
        assertEq(a, 100 ether);
        assertEq(b, 200 ether);
    }

    /// @notice 精确输入的到账金额必须等于含 0.3% 手续费的公式，原始储备乘积不能下降。
    function testExactInputSwap() public {
        _seed();
        uint256 input = 100 ether;
        uint256 expected = input * 997 * RESERVE_B / (RESERVE_A * 1000 + input * 997);
        uint256 beforeB = tokenB.balanceOf(address(this));
        uint256[] memory amounts = router.swapExactTokensForTokens(
            input, expected, _path(address(tokenA), address(tokenB)), address(this), block.timestamp
        );
        assertEq(amounts[1], expected);
        assertEq(tokenB.balanceOf(address(this)) - beforeB, expected);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertGe(uint256(r0) * r1, RESERVE_A * RESERVE_B);
        assertEq(tokenA.balanceOf(address(pair)), RESERVE_A + input);
    }

    /// @notice 精确输出采用向上取整输入；预算不足回滚，预算足够时只支付必要输入。
    function testExactOutputAndMaximumInput() public {
        _seed();
        uint256 output = 50 ether;
        uint256 input = RESERVE_A * output * 1000 / ((RESERVE_B - output) * 997) + 1;
        address[] memory path = _path(address(tokenA), address(tokenB));
        vm.expectRevert("UniswapV2Router: EXCESSIVE_INPUT_AMOUNT");
        router.swapTokensForExactTokens(output, input - 1, path, address(this), block.timestamp);
        uint256 beforeA = tokenA.balanceOf(address(this));
        uint256 beforeB = tokenB.balanceOf(address(this));
        router.swapTokensForExactTokens(output, input, path, address(this), block.timestamp);
        assertEq(beforeA - tokenA.balanceOf(address(this)), input);
        assertEq(tokenB.balanceOf(address(this)) - beforeB, output);
    }

    /// @notice 输出下限高于报价或交易过期都必须拒绝；钱包余额和池储备保持不变。
    function testSlippageAndDeadlineRollback() public {
        _seed();
        address[] memory path = _path(address(tokenA), address(tokenB));
        uint256 quote = router.getAmountsOut(100 ether, path)[1];
        uint256 beforeA = tokenA.balanceOf(address(this));
        vm.expectRevert("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        router.swapExactTokensForTokens(100 ether, quote + 1, path, address(this), block.timestamp);
        vm.expectRevert("UniswapV2Router: EXPIRED");
        router.swapExactTokensForTokens(100 ether, 1, path, address(this), block.timestamp - 1);
        assertEq(tokenA.balanceOf(address(this)), beforeA);
        assertEq(tokenA.balanceOf(address(pair)), RESERVE_A);
        assertEq(tokenB.balanceOf(address(pair)), RESERVE_B);
    }

    /// @notice 即使 burn 已执行，最终滑点校验失败仍回滚 LP 销毁和代币转账。
    function testRemoveLiquiditySlippageRollsBackBurn() public {
        uint256 liquidity = _seed();
        pair.approve(address(router), liquidity);
        vm.expectRevert("UniswapV2Router: INSUFFICIENT_A_AMOUNT");
        router.removeLiquidity(
            address(tokenA), address(tokenB), liquidity, RESERVE_A, 0, address(this), block.timestamp
        );
        assertEq(pair.balanceOf(address(this)), liquidity);
        assertEq(tokenA.balanceOf(address(pair)), RESERVE_A);
    }

    /// @notice 未授权转账必须由 TransferHelper 拒绝，不能留下半完成的交换。
    function testMissingAllowanceReverts() public {
        _seed();
        tokenA.approve(address(router), 0);
        address[] memory path = _path(address(tokenA), address(tokenB));
        vm.expectRevert("TransferHelper::transferFrom: transferFrom failed");
        router.swapExactTokensForTokens(1 ether, 1, path, address(this), block.timestamp);
        assertEq(tokenA.balanceOf(address(pair)), RESERVE_A);
    }

    /// @notice 对随机输入验证正反两个方向的报价、净到账和储备一致，包含极小金额舍入。
    function testFuzzSwapBothDirections(uint96 rawInput, bool reverse) public {
        _seed();
        uint256 input = bound(uint256(rawInput), 1000, 100_000 ether);
        IERC20 source = reverse ? tokenB : tokenA;
        IERC20 destination = reverse ? tokenA : tokenB;
        uint256 reserveIn = reverse ? RESERVE_B : RESERVE_A;
        uint256 reserveOut = reverse ? RESERVE_A : RESERVE_B;
        uint256 expected = input * 997 * reserveOut / (reserveIn * 1000 + input * 997);
        uint256 beforeBalance = destination.balanceOf(address(this));
        router.swapExactTokensForTokens(
            input, expected, _path(address(source), address(destination)), address(this), block.timestamp
        );
        assertEq(destination.balanceOf(address(this)) - beforeBalance, expected);
        assertEq(source.balanceOf(address(pair)), reserveIn + input);
    }

    /// @notice A→B→WETH 的两跳交换由池直接衔接；路由不滞留中间 TokenB。
    function testMultiHopSwap() public {
        _seed();
        router.addLiquidityETH{value: 10 ether}(
            address(tokenB), 1000 ether, 1000 ether, 10 ether, address(this), block.timestamp
        );
        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = weth;
        uint256 expected = router.getAmountsOut(10 ether, path)[2];
        uint256 beforeBalance = IERC20(weth).balanceOf(address(this));
        router.swapExactTokensForTokens(10 ether, expected, path, address(this), block.timestamp);
        assertEq(IERC20(weth).balanceOf(address(this)) - beforeBalance, expected);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    /// @notice 验证 ETH 入池、ETH 买币、Token 卖回 ETH 和 LP 赎回，覆盖 WETH 包装与解包。
    function testEthLiquiditySwapAndRemoval() public {
        (,, uint256 liquidity) = router.addLiquidityETH{value: 10 ether}(
            address(tokenA), 1000 ether, 1000 ether, 10 ether, address(this), block.timestamp
        );
        address[] memory buy = _path(weth, address(tokenA));
        uint256 expected = router.getAmountsOut(1 ether, buy)[1];
        uint256 beforeA = tokenA.balanceOf(address(this));
        router.swapExactETHForTokens{value: 1 ether}(expected, buy, address(this), block.timestamp);
        assertEq(tokenA.balanceOf(address(this)) - beforeA, expected);
        address[] memory sell = _path(address(tokenA), weth);
        uint256 expectedETH = router.getAmountsOut(10 ether, sell)[1];
        uint256 beforeETH = address(this).balance;
        router.swapExactTokensForETH(10 ether, expectedETH, sell, address(this), block.timestamp);
        assertEq(address(this).balance - beforeETH, expectedETH);
        IUniswapV2Pair ethPair = IUniswapV2Pair(factory.getPair(address(tokenA), weth));
        ethPair.approve(address(router), liquidity);
        router.removeLiquidityETH(address(tokenA), liquidity, 1, 1, address(this), block.timestamp);
        assertEq(ethPair.balanceOf(address(this)), 0);
        assertEq(address(router).balance, 0);
        assertEq(IERC20(weth).balanceOf(address(router)), 0);
    }

    /// @notice 不提供输入直接取币必须回滚，乐观输出不能绕过最终偿还检查。
    function testSwapWithoutRepaymentRollsBack() public {
        _seed();
        uint256 beforeBalance = IERC20(pair.token0()).balanceOf(address(this));
        vm.expectRevert("UniswapV2: INSUFFICIENT_INPUT_AMOUNT");
        pair.swap(1 ether, 0, address(this), "");
        assertEq(IERC20(pair.token0()).balanceOf(address(this)), beforeBalance);
    }

    /// @notice 闪电兑换同币偿还需补足手续费，并在回调内验证 Pair 重入锁。
    function testFlashSwapRepaymentAndLock() public {
        _seed();
        uint256 beforeBalance = IERC20(pair.token0()).balanceOf(address(pair));
        pair.swap(1 ether, 0, address(this), hex"01");
        assertEq(
            IERC20(pair.token0()).balanceOf(address(pair)),
            beforeBalance + (uint256(1 ether) * 1000 + 996) / 997 - 1 ether
        );
    }

    /// @notice 仅接受本测试池的回调；验证 sync 被锁拒绝，再按向上取整的同币费用偿还。
    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == address(pair) && sender == address(this) && amount1 == 0, "invalid callback");
        (bool success, bytes memory reason) = address(pair).call(abi.encodeWithSelector(pair.sync.selector));
        assertFalse(success);
        assertEq(reason, abi.encodeWithSignature("Error(string)", "UniswapV2: LOCKED"));
        IERC20(pair.token0()).transfer(address(pair), (amount0 * 1000 + 996) / 997);
    }

    /// @notice skim 取走额外转入部分，sync 则把额外余额计入储备；二者都不会铸造 LP。
    function testSkimAndSync() public {
        _seed();
        tokenA.transfer(address(pair), 1 ether);
        pair.skim(address(0xCAFE));
        assertEq(tokenA.balanceOf(address(0xCAFE)), 1 ether);
        tokenA.transfer(address(pair), 2 ether);
        pair.sync();
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(pair.token0() == address(tokenA) ? r0 : r1, RESERVE_A + 2 ether);
    }

    /// @notice TWAP 累计使用上次储备价格乘时间差，而不是更新后的瞬时余额。
    function testCumulativePriceUsesElapsedTime() public {
        _seed();
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 beforePrice = pair.price0CumulativeLast();
        vm.warp(block.timestamp + 12);
        pair.sync();
        assertEq(pair.price0CumulativeLast() - beforePrice, ((uint256(r1) << 112) / r0) * 12);
    }

    /// @notice 协议费只在下次流动性事件结算；Swap 后不会立即发放 LP。
    function testProtocolFeeMintsOnLiquidityEvent() public {
        address recipient = address(0xCAFE);
        factory.setFeeTo(recipient);
        _seed();
        assertEq(pair.kLast(), RESERVE_A * RESERVE_B);
        router.swapExactTokensForTokens(
            1000 ether, 1, _path(address(tokenA), address(tokenB)), address(this), block.timestamp
        );
        assertEq(pair.balanceOf(recipient), 0);
        router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 200 ether, 1, 1, address(this), block.timestamp
        );
        assertGt(pair.balanceOf(recipient), 0);
        factory.setFeeTo(address(0));
        router.addLiquidity(
            address(tokenA), address(tokenB), 100 ether, 200 ether, 1, 1, address(this), block.timestamp
        );
        assertEq(pair.kLast(), 0);
    }

    /// @notice 本地合成账户的 LP permit 只能使用一次；重放和过期失败不改变 nonce。
    function testPermitRejectsReplayAndExpiry() public {
        address owner = vm.addr(0xA11CE);
        uint256 deadline = block.timestamp + 100;
        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1901",
                pair.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(pair.PERMIT_TYPEHASH(), owner, address(router), uint256(123), uint256(0), deadline)
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, digest);
        pair.permit(owner, address(router), 123, deadline, v, r, s);
        assertEq(pair.allowance(owner, address(router)), 123);
        assertEq(pair.nonces(owner), 1);
        vm.expectRevert("UniswapV2: INVALID_SIGNATURE");
        pair.permit(owner, address(router), 123, deadline, v, r, s);
        vm.warp(deadline + 1);
        vm.expectRevert("UniswapV2: EXPIRED");
        pair.permit(owner, address(router), 123, deadline, v, r, s);
        assertEq(pair.nonces(owner), 1);
    }
}
