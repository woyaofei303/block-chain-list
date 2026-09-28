// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20WithCallback} from "../src/ERC20WithCallback.sol";
import {NFTMarket} from "../src/NFTMarket.sol";
import {NFTMarketV1} from "./fixtures/NFTMarketV1.sol";

contract MarketTestNFT is ERC721 {
    /// @notice 创建仅用于本地测试的 NFT 集合。
    constructor() ERC721("Market Test NFT", "MTNFT") {}

    /// @notice 向指定账户铸造测试 NFT；测试辅助合约不设置铸造权限。
    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

/// @notice 仅用于重入测试的支付合约；在市场付款时反向探测两个购买入口。
contract ReentrantMarketToken {
    NFTMarket private market;
    uint256 private tokenId;

    /// @notice 绑定测试市场与 NFT 编号；此辅助合约不用于真实支付。
    function configure(NFTMarket target, uint256 id) external {
        market = target;
        tokenId = id;
    }

    /// @notice 模拟回调路径给卖家付款，并在返回成功前探测重入。
    function transfer(address, uint256) external returns (bool) {
        _probeReentry();
        return true;
    }

    /// @notice 模拟普通购买扣款，并在返回成功前探测重入。
    function transferFrom(address, address, uint256) external returns (bool) {
        _probeReentry();
        return true;
    }

    /// @notice 外部付款开始时挂单必须已清空，两个重入调用都必须以未上架错误失败。
    function _probeReentry() private {
        (address seller, uint256 price) = market.listings(tokenId);
        require(seller == address(0) && price == 0, "Listing still active during payment");
        (bool bought, bytes memory buyError) = address(market).call(abi.encodeCall(market.buyNFT, (tokenId)));
        (bool received, bytes memory callbackError) =
            address(market).call(abi.encodeCall(market.tokensReceived, (address(this), 1, abi.encode(tokenId))));
        bytes32 expected = keccak256(abi.encodeWithSignature("Error(string)", "NFT not listed"));
        require(!bought && keccak256(buyError) == expected, "Reentrant buy accepted");
        require(!received && keccak256(callbackError) == expected, "Reentrant callback accepted");
    }
}

abstract contract NFTMarketTest is Test {
    event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price);
    event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price);

    uint256 private constant TOKEN_ID = 7;
    uint256 private constant PRICE = 100 ether;

    ERC20WithCallback private token;
    MarketTestNFT private nft;
    NFTMarket private market;
    address private seller;
    address private buyer;

    /// @notice 为两版市场提供相同账户、NFT、余额及部署顺序。
    function setUp() public {
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        token = new ERC20WithCallback();
        nft = new MarketTestNFT();
        market = _deployMarket(address(token), address(nft));

        token.transfer(buyer, 1_000 ether);
        nft.mint(seller, TOKEN_ID);
    }

    /// @notice 验证普通购买的资金、所有权及挂单清空结果。
    function testBuyerCanPurchaseListedNFT() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        (address listedSeller, uint256 listedPrice) = market.listings(TOKEN_ID);
        assertEq(listedSeller, seller);
        assertEq(listedPrice, PRICE);

        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        market.buyNFT(TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), 900 ether);
        (listedSeller, listedPrice) = market.listings(TOKEN_ID);
        assertEq(listedSeller, address(0));
        assertEq(listedPrice, 0);
    }

    /// @notice 验证上架事件的卖家、tokenId 和价格。
    function testListEmitsNFTListed() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);

        vm.expectEmit(true, true, false, true, address(market));
        emit NFTListed(seller, TOKEN_ID, PRICE);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();
    }

    /// @notice 验证普通购买发出完整成交事件。
    function testBuyNFTEmitsNFTSold() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        vm.expectEmit(true, true, true, true, address(market));
        emit NFTSold(seller, buyer, TOKEN_ID, PRICE);
        market.buyNFT(TOKEN_ID);
        vm.stopPrank();
    }

    /// @notice 非持有人不能替他人的 NFT 创建挂单。
    function testNonOwnerCannotListNFT() public {
        vm.prank(buyer);
        vm.expectRevert("Only NFT owner");
        market.list(TOKEN_ID, PRICE);
    }

    /// @notice 零价格必须拒绝，不能与未上架状态混淆。
    function testCannotListNFTForZeroPrice() public {
        vm.prank(seller);
        vm.expectRevert("Price must be positive");
        market.list(TOKEN_ID, 0);
    }

    /// @notice 未授予 NFT 转移权限时不能上架。
    function testListingRequiresMarketApproval() public {
        vm.prank(seller);
        vm.expectRevert("Market not approved");
        market.list(TOKEN_ID, PRICE);
    }

    /// @notice 通过真实 Token 回调完成购买，验证资金、NFT 和成交事件。
    function testBuyerCanPurchaseWithTokenCallbackData() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectEmit(true, true, true, true, address(market));
        emit NFTSold(seller, buyer, TOKEN_ID, PRICE);
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(token.balanceOf(seller), PRICE);
        assertEq(token.balanceOf(buyer), 900 ether);
        assertEq(token.balanceOf(address(market)), 0);
        _assertListing(address(0), 0);
    }

    /// @notice 普通账户伪造 Token 回调必须失败。
    function testForgedTokenCallbackIsRejected() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert("Only payment token");
        market.tokensReceived(buyer, PRICE, abi.encode(TOKEN_ID));
    }

    /// @notice 少付一个最小单位时，外层转账与挂单状态均回滚。
    function testCallbackPurchaseRequiresExactPrice() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert("Incorrect payment amount");
        token.transferWithCallback(address(market), PRICE - 1, abi.encode(TOKEN_ID));

        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        _assertListing(seller, PRICE);
    }

    /// @notice 畸形回调数据必须回滚已转入市场的 Token。
    function testCallbackPurchaseRejectsMalformedData() public {
        vm.prank(buyer);
        vm.expectRevert("Invalid callback data");
        token.transferWithCallback(address(market), PRICE, hex"01");

        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(address(market)), 0);
    }

    /// @notice 验证两版构造函数都拒绝无合约代码的地址。
    function testConstructorRejectsInvalidContracts() public {
        vm.expectRevert("Invalid payment token");
        _deployMarket(address(0), address(nft));

        vm.expectRevert("Invalid NFT");
        _deployMarket(address(token), address(0));
    }

    /// @notice 先成交再由新持有人转售，必须更新卖家、价格并正确结算第二笔。
    function testBuyerCanRelistAndResell() public {
        _listNFT();
        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        market.buyNFT(TOKEN_ID);
        _assertListing(address(0), 0);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE / 2);
        vm.stopPrank();
        _assertListing(buyer, PRICE / 2);

        vm.prank(seller);
        token.transferWithCallback(address(market), PRICE / 2, abi.encode(TOKEN_ID));
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(token.balanceOf(seller), PRICE / 2);
        assertEq(token.balanceOf(buyer), 950 ether);
        _assertListing(address(0), 0);
    }

    /// @notice 成交后两个购买入口都必须拒绝重复结算，保留第一次成交结果。
    function testCannotPurchaseSoldNFTAgain() public {
        _listNFT();
        vm.startPrank(buyer);
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        vm.expectRevert("NFT not listed");
        market.buyNFT(TOKEN_ID);
        vm.expectRevert("NFT not listed");
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        vm.stopPrank();
        assertEq(token.balanceOf(buyer), 900 ether);
        assertEq(token.balanceOf(seller), PRICE);
        _assertListing(address(0), 0);
    }

    /// @notice 报价不压缩为 uint96；大于 96 位及 uint256 最大值均可完整读回。
    function testListingKeepsFullUint256Price() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(market), true);
        market.list(TOKEN_ID, uint256(type(uint96).max) + 1);
        _assertListing(seller, uint256(type(uint96).max) + 1);
        market.list(TOKEN_ID, type(uint256).max);
        vm.stopPrank();
        _assertListing(seller, type(uint256).max);
    }

    /// @notice 模糊测试验证任意正数报价能覆盖旧值，不发生截断或错误下架。
    function testFuzzCanUpdatePrice(uint256 price) public {
        vm.assume(price > 0);
        _listNFT();
        vm.prank(seller);
        market.list(TOKEN_ID, price);
        _assertListing(seller, price);
    }

    /// @notice 验证压缩上界附近以及大额/普通报价反复切换，没有标记冲突或旧值泄露。
    function testExtendedPriceBoundariesAndUpdates() public {
        uint256 boundary = type(uint96).max;
        uint256[5] memory prices = [boundary - 1, boundary, boundary + 1, uint256(1), boundary];
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        for (uint256 i; i < prices.length; ++i) {
            market.list(TOKEN_ID, prices[i]);
            _assertListing(seller, prices[i]);
        }
        vm.stopPrank();

        // 本地注入余额仅为触达超出教学 Token 总供应量的分支，不代表真实发行。
        deal(address(token), buyer, boundary);
        vm.prank(buyer);
        token.transferWithCallback(address(market), boundary, abi.encode(TOKEN_ID));
        assertEq(token.balanceOf(seller), boundary);
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        _assertListing(address(0), 0);
    }

    /// @notice 全 uint256 大额报价可以通过任一付款入口成交，且成交后所有公开状态正确。
    function testFuzzExtendedPricePurchase(uint256 price, bool callback) public {
        price = bound(price, type(uint96).max, type(uint256).max);
        _listNFT();
        vm.prank(seller);
        market.list(TOKEN_ID, price);
        deal(address(token), buyer, price);
        vm.startPrank(buyer);
        if (callback) {
            token.transferWithCallback(address(market), price, abi.encode(TOKEN_ID));
        } else {
            token.approve(address(market), price);
            market.buyNFT(TOKEN_ID);
        }
        vm.stopPrank();
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(token.balanceOf(seller), price);
        assertEq(token.balanceOf(buyer), 0);
        assertEq(token.balanceOf(address(market)), 0);
        _assertListing(address(0), 0);
    }

    /// @notice 大额回调金额错误时恢复完整报价与余额；随后可改成普通报价并成交。
    function testExtendedPriceRollbackAndReturnToNormal() public {
        uint256 price = type(uint256).max;
        _listNFT();
        vm.prank(seller);
        market.list(TOKEN_ID, price);
        deal(address(token), buyer, price);
        vm.prank(buyer);
        vm.expectRevert("Incorrect payment amount");
        token.transferWithCallback(address(market), price - 1, abi.encode(TOKEN_ID));
        _assertListing(seller, price);
        assertEq(token.balanceOf(buyer), price);
        assertEq(token.balanceOf(address(market)), 0);

        vm.prank(seller);
        market.list(TOKEN_ID, PRICE);
        _assertListing(seller, PRICE);
        vm.prank(buyer);
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        _assertListing(address(0), 0);
        assertEq(token.balanceOf(seller), PRICE);
    }

    /// @notice 普通购买与回调结算发生外部付款时，两个入口均不能重入购买同一挂单。
    function testPaymentReentryIsRejectedForBothPaths() public {
        ReentrantMarketToken reentrantToken = new ReentrantMarketToken();
        NFTMarket reentrantMarket = _deployMarket(address(reentrantToken), address(nft));
        reentrantToken.configure(reentrantMarket, TOKEN_ID);
        vm.startPrank(seller);
        nft.approve(address(reentrantMarket), TOKEN_ID);
        reentrantMarket.list(TOKEN_ID, PRICE);
        vm.stopPrank();
        uint256 snapshot = vm.snapshotState();

        vm.prank(buyer);
        reentrantMarket.buyNFT(TOKEN_ID);
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        // 恢复同一挂单，再覆盖由合法 Token 发起的回调结算。
        assertTrue(vm.revertToStateAndDelete(snapshot));
        vm.prank(address(reentrantToken));
        assertTrue(reentrantMarket.tokensReceived(buyer, PRICE, abi.encode(TOKEN_ID)));
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
    }

    /// @notice NFT 转移失败时，两种购买方式都恢复挂单、余额和授权额度。
    function testNFTTransferFailureRollsBackBothPurchasePaths() public {
        _listNFT();
        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);
        vm.startPrank(buyer);
        token.approve(address(market), PRICE);
        vm.expectRevert();
        market.buyNFT(TOKEN_ID);
        assertEq(token.allowance(buyer, address(market)), PRICE);
        vm.expectRevert();
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        vm.stopPrank();
        _assertListing(seller, PRICE);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(market)), 0);
    }

    /// @notice Token 返回 false 时必须恢复挂单，两个付款入口均不得继续转移 NFT。
    function testTokenTransferFailureRollsBackBothPurchasePaths() public {
        _listNFT();
        vm.mockCall(address(token), abi.encodeWithSelector(token.transferFrom.selector), abi.encode(false));
        vm.mockCall(address(token), abi.encodeWithSelector(token.transfer.selector), abi.encode(false));
        vm.startPrank(buyer);
        vm.expectRevert("Token transfer failed");
        market.buyNFT(TOKEN_ID);
        vm.expectRevert("Token transfer failed");
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        vm.stopPrank();
        _assertListing(seller, PRICE);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
        assertEq(token.balanceOf(buyer), 1_000 ether);
        assertEq(token.balanceOf(address(market)), 0);
    }

    /// @notice 分别测量首次上架、改价、普通购买、已售查询及新持有人再次上架。
    /// @dev 使用 --isolate，让每次外部调用都采用独立交易的冷存储与退款口径。
    function testGasListUpdateBuyAndRelist() public {
        _listNFT();
        _recordGas("list.first");
        vm.prank(seller);
        market.list(TOKEN_ID, PRICE * 2);
        _recordGas("list.update");

        vm.startPrank(buyer);
        token.approve(address(market), PRICE * 2);
        market.buyNFT(TOKEN_ID);
        _recordGas("buyNFT");
        market.listings(TOKEN_ID);
        _recordGas("listings.sold");
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        _recordGas("list.relist");
        vm.stopPrank();
        _assertListing(buyer, PRICE);
    }

    /// @notice 测量真实 transferWithCallback 整笔购买，包含代币转入和市场回调。
    function testGasCallbackEndToEnd() public {
        _listNFT();
        vm.prank(buyer);
        token.transferWithCallback(address(market), PRICE, abi.encode(TOKEN_ID));
        _recordGas("callback.endToEnd");
        _assertListing(address(0), 0);
    }

    /// @notice 单独测量成功的 tokensReceived，避免 gas report 只统计伪造回调的失败值。
    /// @dev 预先转入报价后模拟绑定 Token 调用；真实回调链路由上一个测试覆盖。
    function testGasTokensReceived() public {
        _listNFT();
        vm.prank(buyer);
        token.transfer(address(market), PRICE);
        vm.prank(address(token));
        assertTrue(market.tokensReceived(buyer, PRICE, abi.encode(TOKEN_ID)));
        _recordGas("tokensReceived.prefunded");
        _assertListing(address(0), 0);
    }

    /// @notice 单独记录扩展报价路径的成本，避免只展示压缩价格的有利场景。
    function testGasExtendedPrices() public {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, type(uint96).max);
        _recordGas("list.extended.first");
        market.list(TOKEN_ID, type(uint256).max);
        _recordGas("list.extended.update");
        market.listings(TOKEN_ID);
        _recordGas("listings.extended");
        market.list(TOKEN_ID, PRICE);
        _recordGas("list.extendedToNormal");
        vm.stopPrank();
        _assertListing(seller, PRICE);
    }

    /// @notice 测量未上架/在售的查询及 immutable 地址查询，并验证返回值。
    function testGasGetters() public {
        _assertListing(address(0), 0);
        _recordGas("listings.empty");
        _listNFT();
        _assertListing(seller, PRICE);
        _recordGas("listings.active");
        assertEq(address(market.paymentToken()), address(token));
        _recordGas("paymentToken");
        assertEq(address(market.nft()), address(nft));
        _recordGas("nft");
    }

    /// @notice 在测试体内重新部署，以免报告中的 setUp 部署成本显示为零。
    function testGasDeployment() public {
        NFTMarket deployed = _deployMarket(address(token), address(nft));
        assertEq(address(deployed.nft()), address(nft));
    }

    /// @notice 打印 Foundry 记录的最后一次外部调用 Gas 与退款；不包含测试辅助逻辑。
    /// @dev 保留两项原始读数，报告不能忽略退款或将退款重复扣除。
    function _recordGas(string memory label) private {
        Vm.Gas memory usage = vm.lastFrameGas();
        emit log_named_uint(label, usage.gasTotalUsed);
        emit log_named_int(string.concat(label, ".refund"), usage.gasRefunded);
    }

    /// @notice 从卖家账户授权并上架固定测试 NFT，供两版完全相同的场景复用。
    function _listNFT() private {
        vm.startPrank(seller);
        nft.approve(address(market), TOKEN_ID);
        market.list(TOKEN_ID, PRICE);
        vm.stopPrank();
    }

    /// @notice 只通过公开查询断言挂单，不依赖两版内部存储布局。
    function _assertListing(address expectedSeller, uint256 expectedPrice) private view {
        (address listedSeller, uint256 listedPrice) = market.listings(TOKEN_ID);
        assertEq(listedSeller, expectedSeller);
        assertEq(listedPrice, expectedPrice);
    }

    /// @notice 子类仅替换部署字节码，其余测试流程与断言完全共享。
    function _deployMarket(address tokenAddress, address nftAddress) internal virtual returns (NFTMarket);
}

contract NFTMarketV1Test is NFTMarketTest {
    /// @notice 部署冻结的 v1；两版的公开函数、事件与回滚消息保持兼容。
    function _deployMarket(address tokenAddress, address nftAddress) internal override returns (NFTMarket) {
        return NFTMarket(address(new NFTMarketV1(tokenAddress, nftAddress)));
    }
}

contract NFTMarketV2Test is NFTMarketTest {
    /// @notice 固定普通报价的首次上架至少比冻结 v1 省 20%，防止后续退回双槽实现。
    /// @dev 两个市场绑定同一 NFT/Token，并通过 --isolate 保证独立交易的存储访问成本。
    function testListingGasImprovement() public {
        ERC20WithCallback payment = new ERC20WithCallback();
        MarketTestNFT collection = new MarketTestNFT();
        NFTMarketV1 beforeMarket = new NFTMarketV1(address(payment), address(collection));
        NFTMarket afterMarket = new NFTMarket(address(payment), address(collection));
        collection.mint(address(this), 1);
        collection.setApprovalForAll(address(beforeMarket), true);
        collection.setApprovalForAll(address(afterMarket), true);
        beforeMarket.list(1, 100 ether);
        uint256 beforeGas = vm.lastFrameGas().gasTotalUsed;
        afterMarket.list(1, 100 ether);
        uint256 afterGas = vm.lastFrameGas().gasTotalUsed;
        assertLt(afterGas * 100, beforeGas * 80);
    }

    /// @notice 部署当前待优化的实现，运行与 v1 相同的行为测试。
    function _deployMarket(address tokenAddress, address nftAddress) internal override returns (NFTMarket) {
        return new NFTMarket(tokenAddress, nftAddress);
    }
}
