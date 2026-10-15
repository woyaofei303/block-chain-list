// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IToken} from "./interfaces/IToken.sol";
import {IStaking} from "./interfaces/IStaking.sol";

/// @notice 非空池每区块累计 10 KK，按每段时间的 ETH 本金占比分配。
/// @dev 以下注释共用一个例子：100 块 Alice 存 2 ETH；110 块 Bob 存 2 ETH；
/// 120 块 Alice 退 1 ETH；126 块两人都 claim，分别领取 170 KK、90 KK。
/// 用 E = 10^18、P = 10^27 简写整数：1 ETH = E wei，1 KK = E 个 KK 最小单位。
/// 累计值 R 的单位是「KK 最小单位 / wei × P」，不是可直接领取的 KK 数量；
/// 本例两种资产都为 18 位精度，因此 R = 50P 也表示每 ETH 累计分到 50 KK。
contract StakingPool is IStaking, ReentrancyGuard {
    /// @notice 每个非空池区块累计 10 × 10^18 个 KK 最小单位，在 claim 时才铸币。
    /// @dev ether 在这里仅提供 10^18 的数值倍率，不表示发放 ETH。
    uint256 public constant REWARD_PER_BLOCK = 10 ether;

    /// @notice 收益比例的内部放大倍数；KK 本身仍为 18 位精度，不会变成 27 位。
    /// @dev 10E / 3E 的整数结果只有 3；先乘 P 则能保存 floor(10P / 3) 的精细比例。
    /// 计算用户收益时再除 P，避免过早截断；最终不足一个 KK 最小单位的部分仍会舍去。
    uint256 public constant PRECISION = 1e27;

    /// @notice 固定的 KK 合约地址；部署脚本须将其唯一 mint 权限转交给本池。
    IToken public immutable rewardToken;

    /// @notice 全池 ETH 本金，单位 wei；本例依次为 2E、4E、3E，不含 KK 或借贷利息。
    uint256 public totalStaked;

    /// @notice 公共累计值已包含到哪个区块；本例在 120 块结算后同块再查，本段新增块数为零。
    uint256 public lastRewardBlock;

    /// @notice 已写入存储的公共累计收益比例；本例在 110、120、126 块分别为 50P、75P、95P。
    /// @dev 不是全池已发 KK 总量；无人操作时不会自动更新，最新预估由 rewardPerToken() 计算。
    uint256 public rewardPerTokenStored;

    /// @notice 每个用户尚未赎回的 ETH 本金，单位 wei；Alice 在 120 块赎回后为 1E，Bob 为 2E。
    mapping(address => uint256) public override balanceOf;

    /// @notice 用户上次结算时的公共累计值快照，单位与 rewardPerTokenStored 相同。
    /// @dev Paid 不是已领 KK 数量：Bob 在 110 块加入时设为 50P；Alice 到 120 块才从 0 更新到 75P。
    /// 用户只补算「本金 × (最新累计值 - 旧快照) / P」，新用户不会参与加入前的分配。
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice 已结算但尚未领取的 KK 最小单位；Alice 部分退出后为 150E，claim 后清零。
    /// @dev Bob 在 120 块没操作时这里仍为 0，但 earned(Bob) 已有 50E；待领总额还须加未结算部分。
    mapping(address => uint256) public rewards;

    error InvalidToken();
    error ZeroAmount();
    error InsufficientStake();
    error ETHTransferFailed();

    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, uint256 principal, uint256 ethPaid);
    event RewardPaid(address indexed account, uint256 amount);

    /// @notice 绑定可信的 18 位 KK 合约；部署后还须把其 mint 权限交给本池。
    constructor(IToken token) {
        if (address(token).code.length == 0) revert InvalidToken();
        rewardToken = token;
        lastRewardBlock = block.number;
    }

    /// @notice 存入 ETH；先用旧余额结算，保证新增本金不能领取过去的收益。
    function stake() external payable override nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        // Bob 在 110 块入场：先把公共累计值推进到 50P；他的旧本金为 0，收益为 0，快照设为 50P。
        _updateReward(msg.sender);
        // 再把 Bob 的本金加为 2E、全池本金加为 4E，新增资金只参与之后的区块。
        balanceOf[msg.sender] += msg.value;
        totalStaked += msg.value;
        _depositETH(msg.sender, msg.value);
        emit Staked(msg.sender, msg.value);
    }

    /// @notice 赎回不超过账户余额的本金；任何外部调用失败都会回滚本次账本变化。
    function unstake(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 previousBalance = balanceOf[msg.sender];
        if (amount > previousBalance) revert InsufficientStake();
        // Alice 在 120 块仍用旧本金 2E 结算：2E × (75P - 0) / P = 150E，保留在 rewards 中。
        _updateReward(msg.sender);
        // 结算后才把 Alice 本金从 2E 减为 1E；若先扣本金，会少算她过去持有的那 1 ETH。
        balanceOf[msg.sender] = previousBalance - amount;
        totalStaked -= amount;
        uint256 ethPaid = _withdrawETH(msg.sender, amount, previousBalance);
        (bool success,) = payable(msg.sender).call{value: ethPaid}("");
        if (!success) revert ETHTransferFailed();
        emit Unstaked(msg.sender, amount, ethPaid);
    }

    /// @notice 只领取 KK，不改变本金；先清零再铸币，铸币失败会恢复待领金额。
    /// @dev 集中在 126 块领取：累计值从 75P 增至 95P，Alice 领 150E + 20E，Bob 领 90E。
    /// 若改为 Alice 在 121～126 每块 claim，Bob 到 126 才 claim，且两人最后同块领取：
    /// 每次公共增量 d = floor(10E × P / 3E) = 3333333333333333333333333333；6d = 20P - 2。
    /// Alice 每块新增 floor(E × d / P) = 3333333333333333333，首笔还包含旧的 150E，合计 170E - 2。
    /// Bob 使用同一个公共累计值，floor(2E × ((95P - 2) - 50P) / P) = 90E - 1。
    /// 因而 Alice 少 2、Bob 少 1 个 KK 最小单位；公共累计值的差额 2 本身不是 2 个 KK 最小单位。
    /// 两层除法都不保存余数：推进区块或个人快照后不再补算旧区间，频繁结算可能持续积累尾差。
    /// 保持本例本金不变，Alice 逐块领 30 块比一次领少 10 个最小单位；领 300 万块少 100 万个。
    /// 整除或同块无增量时没有新的尾差；提高 P 也不能消除个人领取时不足一个最小单位的截断。
    function claim() external override nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        // 结算快照阻止重复计算旧区间，清零 rewards 阻止重复领取已记账金额；失败则二者一起回滚。
        rewards[msg.sender] = 0;
        rewardToken.mint(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    /// @notice 计算每 wei 本金累计分到的 KK，放大 1e27；空池区间没有可分配奖励。
    /// @dev 100→110 块：100000000000000000000 × P / 2000000000000000000 = 50P。
    /// 110→120 块全池变为 4E，同样的 100E 奖励只增加 25P，公共累计值变成 75P。
    /// 在 121 块只查询时返回 75P + floor(10P / 3)，不会写回存储；126 块才结算则一次增加 20P。
    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 emission = (block.number - lastRewardBlock) * REWARD_PER_BLOCK;
        // mulDiv 先乘 P 再除本金并处理宽中间乘积；若先算 10E / 3E = 3，再乘 P 也恢复不了丢掉的小数。
        return rewardPerTokenStored + Math.mulDiv(emission, PRECISION, totalStaked);
    }

    /// @notice 返回已结算加上当前区块新增收益；整数除法只向下取整，不超发。
    /// @dev 120 块之后只在 121 块查询：Alice 为 150E + 3333333333333333333 个最小单位；
    /// Bob 为 56666666666666666666 个最小单位，包含 110→120 块已应得但尚未记入 rewards 的 50E。
    /// 该块新增待领合计 9999999999999999999，比 10E 少 1；只读查询不会把尾差结算固定。
    /// 若期间都只查询，到 126 块再领取，60E / 3E 正好整除，两人分别领到 170E、90E。
    function earned(address account) public view override returns (uint256) {
        // 必须本金先乘累计值差额，再除 P；先把差额除 P，会把 Alice 每块约 3.333 KK 截成 3 KK。
        return rewards[account]
            + Math.mulDiv(balanceOf[account], rewardPerToken() - userRewardPerTokenPaid[account], PRECISION);
    }

    /// @notice 同步全池累计值及当前用户快照；必须在改变本金之前调用。
    /// @dev 以 120 块 Alice 部分赎回为例：入参 account 为 Alice，旧本金 2E、旧 rewards 为 0、旧快照为 0。
    function _updateReward(address account) internal {
        // ① 右侧先读取旧累计值 50P、旧区块 110，算出 50P + 10 × 10E × P / 4E = 75P，再写入左侧。
        rewardPerTokenStored = rewardPerToken();
        // ② 标记累计值已包含到 120 块；earned 内再调用 rewardPerToken 时新增块数为 120 - 120 = 0。
        // 若漏掉此行，再查询会在 75P 上重复加 25P，错误地把 Alice 的收益算成 200E。
        lastRewardBlock = block.number;
        // ③ 右侧仍用 Alice 的旧 rewards 和旧快照：0 + 2E × (75P - 0) / P = 150E，算完才写回。
        rewards[account] = earned(account);
        // ④ 最后把个人快照设为 75P；若提前覆盖，第三步差额变成 0，尚未结算的旧收益会漏掉。
        // 返回 unstake 后本金才减为 1E；同块再次结算只得到 150E + 1E × (75P - 75P) / P = 150E。
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }

    /// @notice 基础版 ETH 已随 stake 留在本池；借贷版重写此处把 ETH 存入 cETH。
    function _depositETH(address, uint256) internal virtual {}

    /// @notice 基础版按本金原额提款；借贷版重写此处，赎回对应份额并返回实收 ETH。
    function _withdrawETH(address, uint256 amount, uint256) internal virtual returns (uint256) {
        return amount;
    }
}
