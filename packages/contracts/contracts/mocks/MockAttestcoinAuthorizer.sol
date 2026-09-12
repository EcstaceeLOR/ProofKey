// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessPass} from "../AccessPass.sol";

/// @notice Test stand-in for the Attestcoin authorization contract implemented in Issue #4.
contract MockAttestcoinAuthorizer {
    function grant(
        AccessPass accessPass,
        bytes32 authorizationId,
        bytes32 machineId,
        address beneficiary,
        uint64 expiresAt
    ) external {
        accessPass.grantAccess(authorizationId, machineId, beneficiary, expiresAt);
    }
}
