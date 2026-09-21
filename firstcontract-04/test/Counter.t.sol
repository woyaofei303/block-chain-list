// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Counter} from "../contracts/Counter.sol";

contract CounterTest {
    function testCounter() public {
        Counter counter = new Counter();
        require(counter.get() == 0, "initial value must be zero");

        counter.add(5);
        counter.add(3);
        counter.add(0);
        require(counter.get() == 8, "add must accumulate and allow zero");
        require(counter.counter() == 8, "public counter must match get");

        counter.add(type(uint256).max - 8);
        (bool ok, bytes memory reason) = address(counter).call(abi.encodeCall(Counter.add, (1)));
        require(!ok, "overflow must revert");
        require(
            keccak256(reason) == keccak256(abi.encodeWithSignature("Panic(uint256)", 0x11)),
            "overflow must return arithmetic panic"
        );
        require(counter.get() == type(uint256).max, "revert must preserve state");
    }
}
