// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessPass} from "../contracts/AccessPass.sol";
import {MachineRegistry} from "../contracts/MachineRegistry.sol";
import {MockAttestcoinAuthorizer} from "../contracts/mocks/MockAttestcoinAuthorizer.sol";

interface VmMachineAccess {
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MachineRegistryAccessPassTest {
    VmMachineAccess private constant vm =
        VmMachineAccess(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant MACHINE_ID = keccak256("proofkey.generator.001");
    bytes32 private constant METADATA_HASH = keccak256("ipfs://machine-metadata");
    bytes32 private constant AUTHORIZATION_ID = keccak256("attestcoin-authorization-001");
    address private constant CONTROLLER = address(0xC071);
    address private constant NEW_CONTROLLER = address(0xC072);
    address private constant BENEFICIARY = address(0xBEEF);
    address private constant OTHER_USER = address(0xCAFE);
    address private constant OUTSIDER = address(0xBAD);
    uint128 private constant TARIFF = 2_500;
    uint64 private constant CURRENT_TIME = 1_800_000_000;
    uint64 private constant EXPIRY = CURRENT_TIME + 3_600;

    MachineRegistry private machineRegistry;
    AccessPass private accessPass;
    MockAttestcoinAuthorizer private authorizer;

    function setUp() public {
        machineRegistry = new MachineRegistry();
        authorizer = new MockAttestcoinAuthorizer();
        accessPass = new AccessPass(address(machineRegistry), address(authorizer));

        machineRegistry.registerMachine(
            MACHINE_ID,
            CONTROLLER,
            METADATA_HASH,
            TARIFF,
            true
        );
        vm.warp(CURRENT_TIME);
    }

    function test_RegisterMachineStoresCompleteRecord() public view {
        (
            address machineOwner,
            address controller,
            bytes32 metadataHash,
            uint128 tariff,
            bool active
        ) = machineRegistry.machines(MACHINE_ID);

        require(machineOwner == address(this), "owner not stored");
        require(controller == CONTROLLER, "controller not stored");
        require(metadataHash == METADATA_HASH, "metadata hash not stored");
        require(tariff == TARIFF, "tariff not stored");
        require(active, "active status not stored");
    }

    function test_RevertWhenMachineIdIsDuplicate() public {
        vm.expectRevert(
            abi.encodeWithSelector(MachineRegistry.DuplicateMachine.selector, MACHINE_ID)
        );
        machineRegistry.registerMachine(
            MACHINE_ID,
            NEW_CONTROLLER,
            keccak256("other-metadata"),
            TARIFF,
            true
        );
    }

    function test_MachineOwnerCanUpdateControllerAndTariff() public {
        machineRegistry.updateController(MACHINE_ID, NEW_CONTROLLER);
        machineRegistry.updateTariff(MACHINE_ID, TARIFF * 2);

        (, address controller, , uint128 tariff, ) = machineRegistry.machines(MACHINE_ID);
        require(controller == NEW_CONTROLLER, "controller not updated");
        require(tariff == TARIFF * 2, "tariff not updated");
    }

    function test_RevertWhenNonOwnerUpdatesController() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MachineRegistry.NotMachineOwner.selector,
                MACHINE_ID,
                OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        machineRegistry.updateController(MACHINE_ID, NEW_CONTROLLER);
    }

    function test_RevertWhenNonOwnerUpdatesTariff() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MachineRegistry.NotMachineOwner.selector,
                MACHINE_ID,
                OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        machineRegistry.updateTariff(MACHINE_ID, TARIFF * 2);
    }

    function test_AttestcoinAuthorizerCanGrantAccess() public {
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);

        (bytes32 authorizationId, uint64 expiresAt) = accessPass.accessCredentials(
            MACHINE_ID,
            BENEFICIARY
        );
        require(authorizationId == AUTHORIZATION_ID, "authorization id not stored");
        require(expiresAt == EXPIRY, "expiry not stored");
        require(accessPass.isAuthorized(MACHINE_ID, BENEFICIARY), "beneficiary not authorized");
    }

    function test_RevertWhenCallerIsNotAttestcoinAuthorizer() public {
        vm.expectRevert(AccessPass.NotAttestcoinAuthorizer.selector);
        accessPass.grantAccess(AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);
    }

    function test_AccessAutomaticallyExpires() public {
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);
        require(accessPass.isAuthorized(MACHINE_ID, BENEFICIARY), "access not initially valid");

        vm.warp(EXPIRY);
        require(!accessPass.isAuthorized(MACHINE_ID, BENEFICIARY), "access survived expiry");
    }

    function test_AccessCredentialIsNonTransferableAndBeneficiaryBound() public {
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);

        require(accessPass.isAuthorized(MACHINE_ID, BENEFICIARY), "beneficiary not authorized");
        require(!accessPass.isAuthorized(MACHINE_ID, OTHER_USER), "access leaked to other user");
        (, uint64 otherExpiry) = accessPass.accessCredentials(MACHINE_ID, OTHER_USER);
        require(otherExpiry == 0, "other user received credential");
    }

    function test_DeactivatingMachineImmediatelyInvalidatesAccess() public {
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);
        machineRegistry.setMachineActive(MACHINE_ID, false);

        require(!accessPass.isAuthorized(MACHINE_ID, BENEFICIARY), "inactive machine authorized");
    }

    function test_RevertWhenGrantTargetsInactiveMachine() public {
        machineRegistry.setMachineActive(MACHINE_ID, false);

        vm.expectRevert(abi.encodeWithSelector(AccessPass.MachineInactive.selector, MACHINE_ID));
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);
    }

    function test_RevertWhenGrantIsAlreadyExpired() public {
        vm.expectRevert(abi.encodeWithSelector(AccessPass.InvalidExpiry.selector, CURRENT_TIME));
        authorizer.grant(
            accessPass,
            AUTHORIZATION_ID,
            MACHINE_ID,
            BENEFICIARY,
            CURRENT_TIME
        );
    }

    function test_RevertWhenGrantWouldShortenExistingAccess() public {
        authorizer.grant(accessPass, AUTHORIZATION_ID, MACHINE_ID, BENEFICIARY, EXPIRY);
        uint64 shorterExpiry = EXPIRY - 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                AccessPass.AccessNotExtended.selector,
                EXPIRY,
                shorterExpiry
            )
        );
        authorizer.grant(
            accessPass,
            keccak256("later-arriving-authorization"),
            MACHINE_ID,
            BENEFICIARY,
            shorterExpiry
        );
    }

    function test_RevertWhenNonOwnerChangesMachineStatus() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MachineRegistry.NotMachineOwner.selector,
                MACHINE_ID,
                OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        machineRegistry.setMachineActive(MACHINE_ID, false);
    }

    function test_AdministratorCanInitializeAttestcoinAuthorizer() public {
        AccessPass uninitializedAccessPass = new AccessPass(address(machineRegistry), address(0));
        MockAttestcoinAuthorizer replacement = new MockAttestcoinAuthorizer();
        uninitializedAccessPass.setAttestcoinAuthorizer(address(replacement));

        replacement.grant(
            uninitializedAccessPass,
            AUTHORIZATION_ID,
            MACHINE_ID,
            BENEFICIARY,
            EXPIRY
        );
        require(
            uninitializedAccessPass.isAuthorized(MACHINE_ID, BENEFICIARY),
            "initialized authorizer cannot grant"
        );
    }

    function test_AttestcoinAuthorizerCannotBeReplaced() public {
        MockAttestcoinAuthorizer replacement = new MockAttestcoinAuthorizer();

        vm.expectRevert(AccessPass.AttestcoinAuthorizerAlreadySet.selector);
        accessPass.setAttestcoinAuthorizer(address(replacement));
    }
}
