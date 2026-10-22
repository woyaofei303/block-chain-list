// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoNFT} from "../contracts/DemoNFT.sol";
import {NFTMarket} from "market08/NFTMarket.sol";
import {ERC20WithCallback} from "market08/ERC20WithCallback.sol";

contract MarketTest is Test {
    DemoNFT nft;
    ERC20WithCallback token;
    NFTMarket market;
    address buyer = address(0xB0B);

    /// @notice 建立真实市场、NFT 和支付币；测试合约为卖家，buyer 预持有 1000 枚支付币。
    function setUp() public {
        nft = new DemoNFT();
        token = new ERC20WithCallback();
        market = new NFTMarket(address(token), address(nft));
        token.transfer(buyer, 1000 ether);
        nft.mint(address(this), 1, "ipfs://example/1.json");
        nft.approve(address(market), 1);
    }

    /// @notice 改价后按新价格成交，并由买家再次上架；旧订单不得继续消费。
    function testRepriceBuyAndRelist() public {
        market.list(1, 100 ether);
        market.list(1, 120 ether);
        vm.startPrank(buyer);
        token.approve(address(market), 120 ether);
        market.buyNFT(1);
        assertEq(nft.ownerOf(1), buyer);
        assertEq(token.balanceOf(buyer), 880 ether);
        nft.approve(address(market), 1);
        market.list(1, 150 ether);
        vm.stopPrank();
        (address seller, uint256 price) = market.listings(1);
        assertEq(seller, buyer);
        assertEq(price, 150 ether);
    }

    /// @notice 回调购买与普通购买使用同一个市场，成功后 NFT 归买家且市场不留货款。
    function testCallbackBuy() public {
        market.list(1, 100 ether);
        vm.prank(buyer);
        token.transferWithCallback(address(market), 100 ether, abi.encode(uint256(1)));
        assertEq(nft.ownerOf(1), buyer);
        assertEq(token.balanceOf(address(market)), 0);
    }

    /// @notice 演示自买仍产生一次真实结算：所有者与余额不变，报价和恰好授权均被清空。
    function testSelfPurchaseConsumesListingAndAllowance() public {
        uint256 balance = token.balanceOf(address(this));
        market.list(1, 100 ether);
        token.approve(address(market), 100 ether);
        vm.expectEmit(true, true, true, true, address(market));
        emit NFTMarket.NFTSold(address(this), address(this), 1, 100 ether);
        market.buyNFT(1);
        assertEq(nft.ownerOf(1), address(this));
        assertEq(token.balanceOf(address(this)), balance);
        assertEq(token.allowance(address(this), address(market)), 0);
        (, uint256 price) = market.listings(1);
        assertEq(price, 0);
    }

    /// @notice 付款授权不足时，NFT、价格与买家余额必须保持原状。
    function testPaymentFailureRollsBack() public {
        market.list(1, 100 ether);
        vm.prank(buyer);
        vm.expectRevert("ERC20: transfer amount exceeds allowance");
        market.buyNFT(1);
        assertEq(nft.ownerOf(1), address(this));
        assertEq(token.balanceOf(buyer), 1000 ether);
        (, uint256 price) = market.listings(1);
        assertEq(price, 100 ether);
    }

    /// @notice 元数据可读，非铸造者不能产生新 NFT，重复编号也必须失败。
    function testMintPermissionsAndMetadata() public {
        assertEq(nft.tokenURI(1), "ipfs://example/1.json");
        vm.prank(buyer);
        vm.expectRevert("Only minter");
        nft.mint(buyer, 2, "ipfs://example/2.json");
        vm.expectRevert();
        nft.mint(address(this), 1, "ipfs://example/duplicate.json");
    }
}
