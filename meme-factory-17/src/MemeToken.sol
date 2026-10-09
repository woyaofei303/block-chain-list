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

    /// @notice 锁定共享实现的初始化入口；代理各有账本，稍后仍可各初始化一次。
    constructor() ERC20("", "") {
        // 构造函数只在实现合约执行；锁定实现合约，不影响代理自己的初始化状态。
        _disableInitializers();
    }

    /// @notice 给新代理设置符号、上限、每批数量和单价；创建它的调用者成为唯一铸币者。
    /// 工厂会在创建代理的同一交易调用这里，避免把未配置的代理交给别人初始化。
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

    /// @notice 所有代理共用这个名称；不能从只在实现构造时写入的存储取名称。
    function name() public pure override returns (string memory) {
        return "Meme Token";
    }

    /// @notice 返回本代理初始化时设置的符号；DOG 和 CAT 可以共享实现但返回不同值。
    function symbol() public view override returns (string memory) {
        return _memeSymbol;
    }

    /// @notice 此练习只发整数枚，余额 100 就是 100 枚；价格仍按 Wei 计算。
    function decimals() public pure override returns (uint8) {
        // shortcut: 仅支持整数枚；以后支持小数发行时，需要一起调整精度和计价单位。
        return 0;
    }

    /// @notice 仅工厂可给 to 发一整批；剩余额度不足一批时拒绝，不做部分成交。
    function mint(address to) external {
        require(msg.sender == factory, "Only factory");
        // 用剩余额度比较，避免 totalSupply + perMint 的加法溢出，也拒绝最后不足一批的铸造。
        require(perMint <= maxSupply - totalSupply(), "Supply cap reached");
        _mint(to, perMint);
    }
}
