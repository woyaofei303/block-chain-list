// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Bank {
    address public immutable admin;
    mapping(address => uint256) public deposits;
    address[3] public top3;
    bool private withdrawing;

    event Deposited(address indexed depositor, uint256 amount, uint256 cumulativeAmount);
    event Withdrawn(address indexed admin, uint256 amount);

    constructor() {
        admin = msg.sender;
    }

    receive() external payable {
        _deposit();
    }

    function deposit() external payable {
        _deposit();
    }

    function getTop3() external view returns (address[3] memory accounts, uint256[3] memory amounts) {
        accounts = top3;
        for (uint256 i = 0; i < 3; i++) {
            amounts[i] = deposits[accounts[i]];
        }
    }

    function withdraw() external {
        require(msg.sender == admin, "Only admin");
        require(!withdrawing, "Reentrant withdrawal");
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to withdraw");

        withdrawing = true;
        (bool success,) = payable(admin).call{value: amount}("");
        require(success, "Withdrawal failed");
        withdrawing = false;

        emit Withdrawn(admin, amount);
    }

    function _deposit() private {
        require(msg.value > 0, "Deposit must be positive");
        deposits[msg.sender] += msg.value;
        _updateTop3();
        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    function _updateTop3() private {
        uint256 index;
        while (index < 3 && top3[index] != msg.sender) {
            index++;
        }

        if (index == 3) {
            if (deposits[msg.sender] <= deposits[top3[2]]) return;
            index = 2;
            top3[index] = msg.sender;
        }

        while (index > 0 && deposits[msg.sender] > deposits[top3[index - 1]]) {
            top3[index] = top3[index - 1];
            index--;
            top3[index] = msg.sender;
        }
    }
}
