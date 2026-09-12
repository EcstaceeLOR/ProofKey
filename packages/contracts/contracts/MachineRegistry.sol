// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MachineRegistry
/// @notice Stores the owner-controlled identity and commercial state of ProofKey machines.
contract MachineRegistry {
    struct Machine {
        address owner;
        address controller;
        bytes32 metadataHash;
        uint128 tariff;
        bool active;
    }

    mapping(bytes32 machineId => Machine machine) public machines;

    error DuplicateMachine(bytes32 machineId);
    error InvalidController();
    error InvalidMachineId();
    error InvalidMetadataHash();
    error InvalidTariff();
    error MachineNotFound(bytes32 machineId);
    error NotMachineOwner(bytes32 machineId, address caller);

    event MachineRegistered(
        bytes32 indexed machineId,
        address indexed owner,
        address indexed controller,
        bytes32 metadataHash,
        uint128 tariff,
        bool active
    );
    event MachineControllerUpdated(bytes32 indexed machineId, address indexed controller);
    event MachineMetadataUpdated(bytes32 indexed machineId, bytes32 metadataHash);
    event MachineTariffUpdated(bytes32 indexed machineId, uint128 tariff);
    event MachineStatusUpdated(bytes32 indexed machineId, bool active);

    modifier onlyMachineOwner(bytes32 machineId) {
        Machine storage machine = machines[machineId];
        if (machine.owner == address(0)) revert MachineNotFound(machineId);
        if (machine.owner != msg.sender) revert NotMachineOwner(machineId, msg.sender);
        _;
    }

    function registerMachine(
        bytes32 machineId,
        address controller,
        bytes32 metadataHash,
        uint128 tariff,
        bool active
    ) external {
        if (machineId == bytes32(0)) revert InvalidMachineId();
        if (machines[machineId].owner != address(0)) revert DuplicateMachine(machineId);
        if (controller == address(0)) revert InvalidController();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (tariff == 0) revert InvalidTariff();

        machines[machineId] = Machine({
            owner: msg.sender,
            controller: controller,
            metadataHash: metadataHash,
            tariff: tariff,
            active: active
        });

        emit MachineRegistered(
            machineId,
            msg.sender,
            controller,
            metadataHash,
            tariff,
            active
        );
    }

    function updateController(
        bytes32 machineId,
        address controller
    ) external onlyMachineOwner(machineId) {
        if (controller == address(0)) revert InvalidController();

        machines[machineId].controller = controller;
        emit MachineControllerUpdated(machineId, controller);
    }

    function updateMetadataHash(
        bytes32 machineId,
        bytes32 metadataHash
    ) external onlyMachineOwner(machineId) {
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();

        machines[machineId].metadataHash = metadataHash;
        emit MachineMetadataUpdated(machineId, metadataHash);
    }

    function updateTariff(bytes32 machineId, uint128 tariff) external onlyMachineOwner(machineId) {
        if (tariff == 0) revert InvalidTariff();

        machines[machineId].tariff = tariff;
        emit MachineTariffUpdated(machineId, tariff);
    }

    function setMachineActive(
        bytes32 machineId,
        bool active
    ) external onlyMachineOwner(machineId) {
        machines[machineId].active = active;
        emit MachineStatusUpdated(machineId, active);
    }

    function isMachineActive(bytes32 machineId) external view returns (bool) {
        return machines[machineId].active;
    }
}
