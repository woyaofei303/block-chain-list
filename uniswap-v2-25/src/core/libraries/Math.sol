pragma solidity =0.5.16;

// a library for performing various math operations

library Math {
    /// @notice 返回较小值，确保 LP 铸造以投入比例较小的一边为准。
    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x < y ? x : y;
    }

    // babylonian method (https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method)
    /// @notice 巴比伦迭代计算整数平方根并向下取整；处理零与小数值边界。
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
