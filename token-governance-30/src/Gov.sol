// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @notice 使用 GTK 快照投票决定调用；Bank 将本合约设为管理员后，提款须通过提案。
contract Gov is Governor, GovernorVotes, GovernorCountingSimple {
    /// @notice 绑定投票 Token；部署后不能更换，传入地址必须已有合约代码。
    constructor(IVotes votingToken) Governor("Bank DAO") GovernorVotes(votingToken) {
        require(address(votingToken).code.length > 0, "invalid token");
    }

    /// @notice 提案后等待 1 区块形成快照；快照区块结束后才能投票。
    function votingDelay() public pure override returns (uint256) {
        return 1;
    }

    /// @notice 教学投票期为 20 区块，截止区块仍可投票，下一块才可执行。
    function votingPeriod() public pure override returns (uint256) {
        return 20;
    }

    /// @notice 发起提案前一块须至少有 1 GTK 的已委托票权，单位为 18 位最小单位。
    function proposalThreshold() public pure override returns (uint256) {
        return 1 ether;
    }

    /// @notice 赞成加弃权须达到快照总量的 10%；CountingSimple 另要求赞成严格多于反对。
    function quorum(uint256 timepoint) public view override returns (uint256) {
        return token().getPastTotalSupply(timepoint) / 10;
    }
}
