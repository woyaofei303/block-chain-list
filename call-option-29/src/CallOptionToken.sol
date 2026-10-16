// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice 1 枚期权对应 1 ETH，只能在固定 UTC 到期日支付固定行权价换出 ETH。
contract CallOptionToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable issuer;
    IERC20 public immutable paymentToken;
    uint256 public immutable strikePrice;
    uint256 public immutable exerciseStart;
    uint256 public immutable exerciseEnd;
    address[] private _holders;
    mapping(address => bool) private _knownHolder;

    error OnlyIssuer();
    error InvalidTerms();
    error ZeroAmount();
    error IssuanceClosed();
    error OutsideExerciseWindow();
    error NotExpired();
    error TokenExpired();
    error NothingToExpire();
    error UnsupportedPaymentToken();
    error ETHTransferFailed();

    event Issued(uint256 amount);
    event Exercised(address indexed holder, uint256 amount, uint256 payment);
    event Expired(uint256 burned, uint256 ethReturned, uint256 paymentReturned, uint256 remainingHolders);

    /// @notice 固定发行方、支付币、每 ETH 的支付币最小单位价格与未来 UTC 零点，之后不可修改。
    constructor(IERC20 paymentToken_, uint256 strikePrice_, uint256 exerciseStart_)
        ERC20("ETH Call Option", "ETH-CALL")
    {
        // 日期是业务边界，不能用部署时间替代约定的 UTC 自然日。
        if (address(paymentToken_).code.length == 0 || strikePrice_ == 0 || exerciseStart_ % 1 days != 0) {
            revert InvalidTerms();
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (exerciseStart_ <= block.timestamp) revert InvalidTerms();
        issuer = msg.sender;
        paymentToken = paymentToken_;
        strikePrice = strikePrice_;
        exerciseStart = exerciseStart_;
        exerciseEnd = exerciseStart_ + 1 days;
    }

    /// @notice 发行与到期回收仅由部署者操作，持有人不能提前提取抵押。
    modifier onlyIssuer() {
        if (msg.sender != issuer) revert OnlyIssuer();
        _;
    }

    /// @notice 行权日前，发行方每存入 1 wei ETH 就给自己铸造 1 个期权最小单位。
    function issue() external payable nonReentrant onlyIssuer {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= exerciseStart) revert IssuanceClosed();
        if (msg.value == 0) revert ZeroAmount();
        _mint(issuer, msg.value);
        emit Issued(msg.value);
    }

    /// @notice 返回行权所需支付币最小单位，向上取整防止微小期权免费兑换 ETH。
    function quote(uint256 amount) public view returns (uint256) {
        return Math.mulDiv(amount, strikePrice, 1 ether, Math.Rounding.Ceil);
    }

    /// @notice 持有人在 [开始,结束) 内销毁期权并支付行权款；收款或发 ETH 失败时整笔回滚。
    function exercise(uint256 amount) external nonReentrant {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < exerciseStart || block.timestamp >= exerciseEnd) revert OutsideExerciseWindow();
        if (amount == 0) revert ZeroAmount();
        uint256 payment = quote(amount);
        _burn(msg.sender, amount);
        emit Exercised(msg.sender, amount, payment);
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), payment);
        // 必须实际收足行权款；不支持收税或 rebase 的支付币。
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (paymentToken.balanceOf(address(this)) - beforeBalance != payment) revert UnsupportedPaymentToken();
        _sendEth(msg.sender, amount);
    }

    /// @notice 查询尚待清理的历史持有人数量；余额为零的历史账户也需要弹出。
    function remainingHolders() external view returns (uint256) {
        return _holders.length;
    }

    /// @notice 到期后最多处理 maxHolders 个账户，真实销毁并归还等量抵押及已收行权款。
    function expire(uint256 maxHolders) external nonReentrant onlyIssuer {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < exerciseEnd) revert NotExpired();
        if (maxHolders == 0) revert ZeroAmount();
        if (_holders.length == 0) revert NothingToExpire();
        uint256 count = Math.min(maxHolders, _holders.length);
        uint256 burned = 0;
        for (uint256 i = 0; i < count; ++i) {
            address holder = _holders[_holders.length - 1];
            _holders.pop();
            uint256 amount = balanceOf(holder);
            if (amount != 0) {
                burned += amount;
                _burn(holder, amount);
            }
        }
        // 最后一批也取回强制转入的额外 ETH；此前保留未销毁期权的全部抵押。
        uint256 ethReturned = _holders.length == 0 ? address(this).balance : burned;
        uint256 paymentReturned = paymentToken.balanceOf(address(this));
        emit Expired(burned, ethReturned, paymentReturned, _holders.length);
        if (paymentReturned != 0) paymentToken.safeTransfer(issuer, paymentReturned);
        if (ethReturned != 0) _sendEth(issuer, ethReturned);
    }

    /// @notice 到期冻结铸造与转账；只登记真正收到正数余额的账户，防止零额转账污染清理列表。
    function _update(address from, address to, uint256 value) internal override {
        // forge-lint: disable-next-line(block-timestamp)
        if (to != address(0) && block.timestamp >= exerciseEnd) revert TokenExpired();
        super._update(from, to, value);
        if (to != address(0) && value != 0 && !_knownHolder[to]) {
            _knownHolder[to] = true;
            _holders.push(to);
        }
    }

    /// @notice 先更新账本再发送 ETH，接收方拒收则回滚；外部入口统一防重入。
    function _sendEth(address recipient, uint256 amount) private {
        // 目标只来自行权人或固定发行方，金额已销毁对应期权，并检查调用结果。
        // forge-lint: disable-next-line(arbitrary-send-eth, low-level-calls)
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert ETHTransferFailed();
    }
}
