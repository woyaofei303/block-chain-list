// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @notice 供最小代理复用的 ERC20 实现；每个代理拥有独立的余额、供应量和发行参数。
contract MemeToken is ERC20, Initializable {
    string private _memeSymbol;
    address public factory;
    uint256 public maxSupply;
    uint256 public perMint;
    uint256 public price;

    constructor() ERC20("", "") {
        // 构造函数只在实现合约执行；锁定实现合约，不影响代理自己的初始化状态。
        _disableInitializers();
    }

    function initialize(string memory symbol_, uint256 maxSupply_, uint256 perMint_, uint256 price_)
        external
        initializer
    {
        require(bytes(symbol_).length > 0, "Empty symbol");
        require(perMint_ > 0 && maxSupply_ >= perMint_, "Invalid supply");
        require(price_ <= type(uint256).max / perMint_, "Mint cost overflow");
        factory = msg.sender;
        _memeSymbol = symbol_;
        maxSupply = maxSupply_;
        perMint = perMint_;
        price = price_;
    }

    // 代理不会执行 ERC20 构造函数，必须显式提供 name/symbol，不能依赖构造时的存储。
    function name() public pure override returns (string memory) {
        return "Meme Token";
    }

    function symbol() public view override returns (string memory) {
        return _memeSymbol;
    }

    function decimals() public pure override returns (uint8) {
        // ponytail: 本练习只支持整数枚；需要小数发行时同步调整精度和计价单位。
        return 0;
    }

    function mint(address to) external {
        require(msg.sender == factory, "Only factory");
        // 用剩余额度比较，避免 totalSupply + perMint 的加法溢出，也拒绝最后不足一批的铸造。
        require(perMint <= maxSupply - totalSupply(), "Supply cap reached");
        _mint(to, perMint);
    }
}
