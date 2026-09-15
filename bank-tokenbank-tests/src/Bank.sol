// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Bank {
    address public immutable admin;
    mapping(address => uint256) public deposits;
    address[3] public top3;

    constructor() {
        admin = msg.sender;
    }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        require(msg.value > 0, "Deposit must be positive");
        deposits[msg.sender] += msg.value;
        _updateTop3(msg.sender);
    }

    function withdraw() external {
        require(msg.sender == admin, "Only admin");
        (bool success,) = payable(admin).call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }

    function _updateTop3(address depositor) private {
        uint256 index;
        while (index < 3 && top3[index] != depositor) index++;

        if (index == 3) {
            if (deposits[depositor] <= deposits[top3[2]]) return;
            index = 2;
            top3[index] = depositor;
        }

        while (index > 0 && deposits[depositor] > deposits[top3[index - 1]]) {
            top3[index] = top3[index - 1];
            index--;
            top3[index] = depositor;
        }
    }
}
