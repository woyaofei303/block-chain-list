// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MemeToken} from "./MemeToken.sol";

/// @notice 固定批量、公平价格铸造的 Meme 工厂；工厂部署者为平台收款人。
contract MemeFactory is ReentrancyGuard {
    address public immutable implementation;
    address public immutable projectOwner;
    mapping(address token => address issuer) public issuerOf;

    event MemeDeployed(
        address indexed token,
        address indexed issuer,
        string symbol,
        uint256 totalSupply,
        uint256 perMint,
        uint256 price
    );
    event MemeMinted(
        address indexed token,
        address indexed buyer,
        uint256 amount,
        uint256 cost,
        uint256 platformFee,
        uint256 issuerFee
    );

    constructor() {
        projectOwner = msg.sender;
        implementation = address(new MemeToken());
    }

    /// @param totalSupply 最多发行的整数枚数；不是创建时预铸给发行者的数量。
    /// @param price 每一枚的价格，单位 wei；一次铸造费用为 perMint * price。
    function deployMeme(string calldata symbol, uint256 totalSupply, uint256 perMint, uint256 price)
        external
        returns (address tokenAddr)
    {
        tokenAddr = Clones.clone(implementation);
        // 创建和初始化必须原子完成，不能把未初始化的代理留给下一笔交易。
        MemeToken(tokenAddr).initialize(symbol, totalSupply, perMint, price);
        issuerOf[tokenAddr] = msg.sender;
        emit MemeDeployed(tokenAddr, msg.sender, symbol, totalSupply, perMint, price);
    }

    function mintMeme(address tokenAddr) external payable nonReentrant {
        address issuer = issuerOf[tokenAddr];
        require(issuer != address(0), "Unknown meme");
        MemeToken token = MemeToken(tokenAddr);
        uint256 amount = token.perMint();
        uint256 cost = amount * token.price();
        require(msg.value == cost, "Incorrect payment");

        // 先更新代币状态，再向外部收款地址转账；任一步失败会撤销整笔交易。
        token.mint(msg.sender);
        uint256 platformFee = cost / 100;
        uint256 issuerFee = cost - platformFee; // wei 无法再细分，舍入余数归发行者。
        _pay(projectOwner, platformFee);
        _pay(issuer, issuerFee);
        emit MemeMinted(tokenAddr, msg.sender, amount, cost, platformFee, issuerFee);
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = payable(recipient).call{value: amount}("");
        require(success, "Fee transfer failed");
    }
}
