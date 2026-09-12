// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMachineRegistry {
    function isMachineActive(bytes32 machineId) external view returns (bool);
}

/// @title AccessPass
/// @notice Non-transferable, expiring machine access issued from Attestcoin authorization.
/// @dev Credentials are address-bound mapping entries rather than transferable token balances.
contract AccessPass {
    struct AccessCredential {
        bytes32 authorizationId;
        uint64 expiresAt;
    }

    IMachineRegistry public immutable machineRegistry;
    address public administrator;
    address public attestcoinAuthorizer;

    mapping(bytes32 machineId => mapping(address beneficiary => AccessCredential credential))
        public accessCredentials;

    error AccessNotExtended(uint64 currentExpiry, uint64 proposedExpiry);
    error InvalidAdministrator();
    error InvalidAttestcoinAuthorizer();
    error InvalidAuthorizationId();
    error InvalidBeneficiary();
    error InvalidExpiry(uint64 expiresAt);
    error InvalidMachineRegistry();
    error AttestcoinAuthorizerAlreadySet();
    error MachineInactive(bytes32 machineId);
    error NotAdministrator();
    error NotAttestcoinAuthorizer();

    event AccessGranted(
        bytes32 indexed authorizationId,
        bytes32 indexed machineId,
        address indexed beneficiary,
        uint64 expiresAt
    );
    event AdministratorTransferred(address indexed previousAdministrator, address indexed newAdministrator);
    event AttestcoinAuthorizerUpdated(
        address indexed previousAuthorizer,
        address indexed newAuthorizer
    );

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert NotAdministrator();
        _;
    }

    modifier onlyAttestcoinAuthorizer() {
        if (msg.sender != attestcoinAuthorizer) revert NotAttestcoinAuthorizer();
        _;
    }

    constructor(address machineRegistryAddress, address attestcoinAuthorizerAddress) {
        if (machineRegistryAddress.code.length == 0) revert InvalidMachineRegistry();
        if (
            attestcoinAuthorizerAddress != address(0) &&
            attestcoinAuthorizerAddress.code.length == 0
        ) {
            revert InvalidAttestcoinAuthorizer();
        }

        machineRegistry = IMachineRegistry(machineRegistryAddress);
        administrator = msg.sender;
        attestcoinAuthorizer = attestcoinAuthorizerAddress;

        emit AdministratorTransferred(address(0), msg.sender);
        if (attestcoinAuthorizerAddress != address(0)) {
            emit AttestcoinAuthorizerUpdated(address(0), attestcoinAuthorizerAddress);
        }
    }

    /// @notice Records authorization proven by the configured Attestcoin authorization contract.
    function grantAccess(
        bytes32 authorizationId,
        bytes32 machineId,
        address beneficiary,
        uint64 expiresAt
    ) external onlyAttestcoinAuthorizer {
        if (authorizationId == bytes32(0)) revert InvalidAuthorizationId();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);
        if (!machineRegistry.isMachineActive(machineId)) revert MachineInactive(machineId);

        AccessCredential storage credential = accessCredentials[machineId][beneficiary];
        if (expiresAt <= credential.expiresAt) {
            revert AccessNotExtended(credential.expiresAt, expiresAt);
        }

        credential.authorizationId = authorizationId;
        credential.expiresAt = expiresAt;
        emit AccessGranted(authorizationId, machineId, beneficiary, expiresAt);
    }

    /// @notice Returns live authorization; expiry and machine deactivation apply automatically.
    function isAuthorized(bytes32 machineId, address beneficiary) external view returns (bool) {
        return
            beneficiary != address(0) &&
            machineRegistry.isMachineActive(machineId) &&
            accessCredentials[machineId][beneficiary].expiresAt > block.timestamp;
    }

    function setAttestcoinAuthorizer(address newAuthorizer) external onlyAdministrator {
        if (attestcoinAuthorizer != address(0)) revert AttestcoinAuthorizerAlreadySet();
        if (newAuthorizer.code.length == 0) revert InvalidAttestcoinAuthorizer();

        attestcoinAuthorizer = newAuthorizer;
        emit AttestcoinAuthorizerUpdated(address(0), newAuthorizer);
    }

    function transferAdministration(address newAdministrator) external onlyAdministrator {
        if (newAdministrator == address(0)) revert InvalidAdministrator();

        address previousAdministrator = administrator;
        administrator = newAdministrator;
        emit AdministratorTransferred(previousAdministrator, newAdministrator);
    }
}
