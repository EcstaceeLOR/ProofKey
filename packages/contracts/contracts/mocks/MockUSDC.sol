// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal six-decimal test token for local development and Sepolia demos only.
contract MockUSDC {
    string public constant name = "ProofKey Mock USDC";
    string public constant symbol = "pkUSDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidRecipient();

    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert InvalidRecipient();

        uint256 availableAllowance = allowance[from][msg.sender];
        if (availableAllowance < amount) revert InsufficientAllowance();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        if (availableAllowance != type(uint256).max) {
            allowance[from][msg.sender] = availableAllowance - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
        return true;
    }

    /// @dev Permissionless because this token must never be used outside test networks.
    function mint(address recipient, uint256 amount) external {
        if (recipient == address(0)) revert InvalidRecipient();

        totalSupply += amount;
        balanceOf[recipient] += amount;
        emit Transfer(address(0), recipient, amount);
    }
}
