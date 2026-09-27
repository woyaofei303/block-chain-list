// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {MemeFactory} from "../src/MemeFactory.sol";
import {MemeToken} from "../src/MemeToken.sol";

contract RejectingRecipient {
    bool public rejects = true;

    function acceptPayments() external {
        rejects = false;
    }

    receive() external payable {
        require(!rejects, "Payment rejected");
    }
}

contract ReentrantRecipient {
    MemeFactory private factory;
    address private token;
    uint256 private cost;
    bool public attempted;
    bool public succeeded;
    bytes public reason;

    function arm(MemeFactory factory_, address token_, uint256 cost_) external {
        factory = factory_;
        token = token_;
        cost = cost_;
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            (succeeded, reason) = address(factory).call{value: cost}(abi.encodeCall(MemeFactory.mintMeme, (token)));
        }
    }
}

contract MemeFactoryTest is Test {
    address private constant PLATFORM = address(0x1001);
    address private constant ISSUER = address(0x1002);
    address private constant BUYER = address(0x1003);
    MemeFactory private factory;
    MemeToken private token;

    function setUp() public {
        vm.prank(PLATFORM);
        factory = new MemeFactory();
        vm.prank(ISSUER);
        token = MemeToken(factory.deployMeme("DOG", 300, 100, 1 gwei));
        vm.deal(BUYER, 1 ether);
    }

    function testMintPaysOnePercentToPlatformAndRemainderToIssuer() public {
        uint256 cost = 100 * 1 gwei;
        uint256 buyerBefore = BUYER.balance;
        vm.prank(BUYER);
        factory.mintMeme{value: cost}(address(token));

        assertEq(PLATFORM.balance, 1_000_000_000, "platform must receive 1%");
        assertEq(ISSUER.balance, 99_000_000_000, "issuer must receive 99%");
        assertEq(BUYER.balance, buyerBefore - cost);
        assertEq(address(factory).balance, 0);
        assertEq(token.balanceOf(BUYER), 100);
        assertEq(token.totalSupply(), 100);
        emit log_named_uint("minted tokens", token.balanceOf(BUYER));
        emit log_named_uint("platform received wei", PLATFORM.balance);
        emit log_named_uint("issuer received wei", ISSUER.balance);
    }

    function testEveryMintHasFixedAmountAndCannotExceedTotalSupply() public {
        for (uint256 i = 1; i <= 3; i++) {
            vm.prank(BUYER);
            factory.mintMeme{value: 100 gwei}(address(token));
            assertEq(token.balanceOf(BUYER), i * 100);
            assertEq(token.totalSupply(), i * 100);
        }

        uint256 buyerBefore = BUYER.balance;
        vm.expectRevert("Supply cap reached");
        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(token));
        assertEq(token.totalSupply(), 300);
        assertEq(BUYER.balance, buyerBefore);
        assertEq(PLATFORM.balance, 3_000_000_000);
        assertEq(ISSUER.balance, 297_000_000_000);
        assertEq(address(factory).balance, 0);
        emit log_named_uint("supply after three mints", token.totalSupply());
        emit log_named_uint("maximum supply", token.maxSupply());
    }

    function testIssuerCannotReenterMintDuringPayment() public {
        _assertReentryBlocked(false);
    }

    function testPlatformCannotReenterMintDuringPayment() public {
        _assertReentryBlocked(true);
    }

    function _assertReentryBlocked(bool attackAsPlatform) private {
        ReentrantRecipient recipient = new ReentrantRecipient();
        if (attackAsPlatform) {
            vm.prank(address(recipient));
            factory = new MemeFactory();
        }
        vm.prank(attackAsPlatform ? ISSUER : address(recipient));
        MemeToken attacked = MemeToken(factory.deployMeme("ATTACK", 300, 100, 1 gwei));
        recipient.arm(factory, address(attacked), 100 gwei);
        // 攻击者预先有足够资金，确保失败原因是重入保护，而不是余额不足。
        vm.deal(address(recipient), 100 gwei);
        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(attacked));

        assertTrue(recipient.attempted());
        assertFalse(recipient.succeeded());
        assertEq(recipient.reason(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(attacked.totalSupply(), 100);
        assertEq(attacked.balanceOf(BUYER), 100);
        assertEq(attacked.balanceOf(address(recipient)), 0);
        assertEq(address(recipient).balance, attackAsPlatform ? 101 gwei : 199 gwei);
        assertEq(attackAsPlatform ? ISSUER.balance : PLATFORM.balance, attackAsPlatform ? 99 gwei : 1 gwei);
        assertEq(address(factory).balance, 0);
    }

    function testCloneBytecodeMetadataAndStorageIsolation() public {
        vm.prank(BUYER);
        MemeToken second = MemeToken(factory.deployMeme("CAT", 50, 5, 2 gwei));
        bytes memory expectedCode =
            abi.encodePacked(hex"363d3d373d3d3d363d73", factory.implementation(), hex"5af43d82803e903d91602b57fd5bf3");
        assertEq(address(token).code.length, 45);
        assertEq(address(token).code, expectedCode);
        assertEq(address(second).code, expectedCode);
        assertTrue(address(token) != address(second));
        assertEq(factory.projectOwner(), PLATFORM);
        assertEq(factory.issuerOf(address(token)), ISSUER);
        assertEq(factory.issuerOf(address(second)), BUYER);
        assertEq(token.factory(), address(factory));
        assertEq(token.name(), "Meme Token");
        assertEq(token.symbol(), "DOG");
        assertEq(second.symbol(), "CAT");
        assertEq(token.decimals(), 0);
        assertEq(token.maxSupply(), 300);
        assertEq(token.perMint(), 100);
        assertEq(token.price(), 1 gwei);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(ISSUER), 0);

        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(token));
        assertEq(second.totalSupply(), 0);
        assertEq(second.balanceOf(BUYER), 0);
        assertEq(second.maxSupply(), 50);
        assertEq(MemeToken(factory.implementation()).totalSupply(), 0);
    }

    function testImplementationAndCloneCannotBeInitializedAgain() public {
        MemeToken implementation = MemeToken(factory.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize("BAD", 10, 1, 0);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vm.prank(BUYER);
        token.initialize("BAD", 10, 1, 0);
        assertEq(token.symbol(), "DOG");
        assertEq(token.factory(), address(factory));
        assertEq(token.maxSupply(), 300);
    }

    function testOnlyFactoryCanMintEvenIssuerCannotBypassPayment() public {
        vm.expectRevert("Only factory");
        vm.prank(ISSUER);
        token.mint(ISSUER);
        vm.expectRevert("Only factory");
        vm.prank(BUYER);
        token.mint(BUYER);
        assertEq(token.totalSupply(), 0);
    }

    function testRejectsInvalidDeploymentParameters() public {
        vm.expectRevert("Empty symbol");
        factory.deployMeme("", 100, 10, 1);
        vm.expectRevert("Invalid supply");
        factory.deployMeme("BAD", 0, 1, 1);
        vm.expectRevert("Invalid supply");
        factory.deployMeme("BAD", 100, 0, 1);
        vm.expectRevert("Invalid supply");
        factory.deployMeme("BAD", 10, 11, 1);
        vm.expectRevert("Mint cost overflow");
        factory.deployMeme("BAD", 2, 2, type(uint256).max);
    }

    function testRejectsUnregisteredTokensIncludingAnotherFactoryClone() public {
        MemeFactory other = new MemeFactory();
        address foreignToken = other.deployMeme("FOREIGN", 10, 1, 0);
        address[4] memory unknown = [address(0), BUYER, factory.implementation(), foreignToken];
        for (uint256 i; i < unknown.length; i++) {
            vm.expectRevert("Unknown meme");
            factory.mintMeme(unknown[i]);
        }
        assertEq(MemeToken(foreignToken).totalSupply(), 0);
    }

    function testUnderpaymentAndOverpaymentRevertWithoutChangingState() public {
        vm.startPrank(BUYER);
        vm.expectRevert("Incorrect payment");
        factory.mintMeme{value: 100 gwei - 1}(address(token));
        vm.expectRevert("Incorrect payment");
        factory.mintMeme{value: 100 gwei + 1}(address(token));
        vm.stopPrank();
        assertEq(BUYER.balance, 1 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(BUYER), 0);
        assertEq(PLATFORM.balance, 0);
        assertEq(ISSUER.balance, 0);
        assertEq(address(factory).balance, 0);
    }

    function testRemainingSupplySmallerThanBatchIsNotPartiallyMinted() public {
        vm.prank(ISSUER);
        MemeToken uneven = MemeToken(factory.deployMeme("ODD", 250, 100, 1));
        vm.startPrank(BUYER);
        factory.mintMeme{value: 100}(address(uneven));
        factory.mintMeme{value: 100}(address(uneven));
        vm.expectRevert("Supply cap reached");
        factory.mintMeme{value: 100}(address(uneven));
        vm.stopPrank();
        assertEq(uneven.totalSupply(), 200);
        assertEq(uneven.balanceOf(BUYER), 200);
        assertEq(PLATFORM.balance, 2);
        assertEq(ISSUER.balance, 198);
        assertEq(BUYER.balance, 1 ether - 200);
    }

    function testRoundingDustGoesToIssuerAndZeroFeeSkipsTransfer() public {
        RejectingRecipient platform = new RejectingRecipient();
        vm.prank(address(platform));
        MemeFactory roundingFactory = new MemeFactory();
        vm.prank(ISSUER);
        address cheap = roundingFactory.deployMeme("TINY", 99, 99, 1);
        vm.prank(BUYER);
        roundingFactory.mintMeme{value: 99}(cheap);
        assertEq(address(platform).balance, 0);
        assertEq(ISSUER.balance, 99);

        vm.prank(ISSUER);
        address rounded = factory.deployMeme("ROUND", 1, 1, 101);
        vm.prank(BUYER);
        factory.mintMeme{value: 101}(rounded);
        assertEq(PLATFORM.balance, 1);
        assertEq(ISSUER.balance, 199);
    }

    function testFreeMintWorksEvenWhenBothRecipientsRejectEth() public {
        RejectingRecipient recipient = new RejectingRecipient();
        vm.startPrank(address(recipient));
        MemeFactory freeFactory = new MemeFactory();
        address freeToken = freeFactory.deployMeme("FREE", 1, 1, 0);
        vm.stopPrank();
        vm.prank(BUYER);
        freeFactory.mintMeme(freeToken);
        assertEq(MemeToken(freeToken).balanceOf(BUYER), 1);
        assertEq(MemeToken(freeToken).totalSupply(), 1);
        assertEq(BUYER.balance, 1 ether);
        assertEq(address(freeFactory).balance, 0);
    }

    function testIssuerRejectingEthRollsBackMintAndPlatformPayment() public {
        _assertPaymentRollback(false);
    }

    function testPlatformRejectingEthRollsBackMintAndAllowsRetry() public {
        _assertPaymentRollback(true);
    }

    function _assertPaymentRollback(bool rejectAsPlatform) private {
        RejectingRecipient recipient = new RejectingRecipient();
        if (rejectAsPlatform) {
            vm.prank(address(recipient));
            factory = new MemeFactory();
        }
        vm.prank(rejectAsPlatform ? ISSUER : address(recipient));
        MemeToken rejected = MemeToken(factory.deployMeme("REJECT", 200, 100, 1 gwei));
        vm.expectRevert("Fee transfer failed");
        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(rejected));
        assertEq(rejected.totalSupply(), 0);
        assertEq(rejected.balanceOf(BUYER), 0);
        assertEq(BUYER.balance, 1 ether);
        assertEq(PLATFORM.balance, 0);
        assertEq(ISSUER.balance, 0);
        assertEq(address(recipient).balance, 0);
        assertEq(address(factory).balance, 0);

        recipient.acceptPayments();
        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(rejected));
        assertEq(rejected.totalSupply(), 100);
        assertEq(rejected.balanceOf(BUYER), 100);
        assertEq(address(recipient).balance, rejectAsPlatform ? 1 gwei : 99 gwei);
        assertEq(rejectAsPlatform ? ISSUER.balance : PLATFORM.balance, rejectAsPlatform ? 99 gwei : 1 gwei);
        assertEq(BUYER.balance, 1 ether - 100 gwei);
        assertEq(address(factory).balance, 0);
    }

    function testCloneSupportsErc20TransfersAndAllowances() public {
        vm.prank(BUYER);
        factory.mintMeme{value: 100 gwei}(address(token));
        vm.startPrank(BUYER);
        assertTrue(token.transfer(ISSUER, 10));
        assertTrue(token.approve(PLATFORM, 20));
        vm.stopPrank();
        vm.prank(PLATFORM);
        assertTrue(token.transferFrom(BUYER, ISSUER, 20));
        assertEq(token.balanceOf(BUYER), 70);
        assertEq(token.balanceOf(ISSUER), 30);
        assertEq(token.allowance(BUYER, PLATFORM), 0);
        assertEq(token.totalSupply(), 100);
    }

    function testFuzzFixedBatchesConserveFeesAndRespectCap(uint64 unitPrice, uint32 batch, uint8 batches, uint32 dust)
        public
    {
        uint256 amount = bound(batch, 1, 1_000_000);
        uint256 count = bound(batches, 1, 8);
        uint256 remainder = uint256(dust) % amount;
        uint256 cost = amount * uint256(unitPrice);
        vm.prank(ISSUER);
        MemeToken fuzzToken = MemeToken(factory.deployMeme("FUZZ", amount * count + remainder, amount, unitPrice));
        vm.deal(BUYER, cost * (count + 1));
        vm.startPrank(BUYER);
        for (uint256 i = 1; i <= count; i++) {
            factory.mintMeme{value: cost}(address(fuzzToken));
            assertEq(fuzzToken.totalSupply(), amount * i);
            assertEq(fuzzToken.balanceOf(BUYER), amount * i);
            assertEq(PLATFORM.balance, (cost / 100) * i);
            assertEq(ISSUER.balance, (cost - cost / 100) * i);
            assertEq(PLATFORM.balance + ISSUER.balance, cost * i);
            assertEq(address(factory).balance, 0);
        }
        vm.expectRevert("Supply cap reached");
        factory.mintMeme{value: cost}(address(fuzzToken));
        vm.stopPrank();
        assertEq(BUYER.balance, cost);
        assertEq(fuzzToken.totalSupply(), amount * count);
        assertLe(fuzzToken.totalSupply(), fuzzToken.maxSupply());
    }

    function testCloneCreationUsesLessGasThanDeployingFullImplementation() public {
        uint256 beforeClone = gasleft();
        address clone = factory.deployMeme("GAS", 300, 100, 1 gwei);
        uint256 cloneGas = beforeClone - gasleft();
        uint256 beforeFull = gasleft();
        MemeToken full = new MemeToken();
        uint256 fullGas = beforeFull - gasleft();
        // 保守基准：clone 已含初始化、登记和事件；完整实现仅部署，还不含发行参数初始化。
        assertLt(cloneGas, fullGas);
        assertEq(clone.code.length, 45);
        emit log_named_uint("clone creation + initialization gas", cloneGas);
        emit log_named_uint("full implementation deployment gas", fullGas);
        emit log_named_uint("clone runtime bytes", clone.code.length);
        emit log_named_uint("full implementation runtime bytes", address(full).code.length);
    }
}
