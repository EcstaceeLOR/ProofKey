// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {AccessPass} from "./AccessPass.sol";
import {MachineRegistry} from "./MachineRegistry.sol";

/// @title ProofKeyASC
/// @notice Converts a verified Sepolia UsagePaid receipt into atomic Creditcoin access.
/// @dev There is deliberately no administrative or worker-controlled access-granting function.
contract ProofKeyASC {
    uint8 public constant AUTHORIZE_ACCESS_ACTION = 0;
    uint64 public constant SEPOLIA_CHAIN_KEY = 1;
    uint64 public constant MAX_DURATION = 30 days;
    bytes32 public constant USAGE_PAID_EVENT_SIGNATURE =
        keccak256(
            "UsagePaid(bytes32,bytes32,address,address,uint64,uint64,uint256)"
        );

    INativeQueryVerifier public immutable verifier;
    address public immutable sourcePaymentRegistry;
    MachineRegistry public immutable machineRegistry;
    AccessPass public immutable accessPass;

    mapping(bytes32 queryId => bool processed) public processedQueries;
    mapping(bytes32 orderId => bool processed) public processedOrders;

    uint256 private locked = 1;

    error DuplicateOrder(bytes32 orderId);
    error FailedSourceReceipt();
    error InvalidAction(uint8 action);
    error InvalidAmount(uint256 actual, uint256 expected);
    error InvalidDuration(uint64 duration);
    error InvalidEventCount(uint256 count);
    error InvalidEventTopics();
    error InvalidExpiry(uint64 expiresAt);
    error InvalidMachine(bytes32 machineId);
    error InvalidMachineRegistry();
    error InvalidPayer();
    error InvalidSourcePaymentRegistry();
    error InvalidAccessPass();
    error InvalidTransactionType(uint8 transactionType);
    error PayerMismatch(address eventPayer, address transactionSender);
    error ProofVerificationFailed();
    error QueryAlreadyProcessed(bytes32 queryId);
    error ReentrantCall();
    error WrongBeneficiary(address actual, address expected);
    error WrongSourceAddress(address actual, address expected);
    error WrongSourceChain(uint64 actual, uint64 expected);

    event ProofKeyAccessActivated(
        bytes32 indexed queryId,
        bytes32 indexed orderId,
        bytes32 indexed machineId,
        address payer,
        uint64 expiresAt
    );

    modifier nonReentrant() {
        if (locked != 1) revert ReentrantCall();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(
        address sourcePaymentRegistryAddress,
        address machineRegistryAddress,
        address accessPassAddress
    ) {
        if (sourcePaymentRegistryAddress == address(0)) {
            revert InvalidSourcePaymentRegistry();
        }
        if (machineRegistryAddress.code.length == 0) revert InvalidMachineRegistry();
        if (accessPassAddress.code.length == 0) revert InvalidAccessPass();

        verifier = NativeQueryVerifierLib.getVerifier();
        sourcePaymentRegistry = sourcePaymentRegistryAddress;
        machineRegistry = MachineRegistry(machineRegistryAddress);
        accessPass = AccessPass(accessPassAddress);
    }

    /// @notice Verifies a native Attestcoin proof and activates the proven payer's access.
    /// @dev The calldata shape matches the official ASC readability execution flow.
    function execute(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external nonReentrant returns (bool success) {
        if (action != AUTHORIZE_ACCESS_ACTION) revert InvalidAction(action);
        if (chainKey != SEPOLIA_CHAIN_KEY) {
            revert WrongSourceChain(chainKey, SEPOLIA_CHAIN_KEY);
        }

        INativeQueryVerifier.MerkleProof memory merkleProof = INativeQueryVerifier
            .MerkleProof({root: merkleRoot, siblings: siblings});
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleProof);
        if (processedQueries[queryId]) revert QueryAlreadyProcessed(queryId);

        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier
            .ContinuityProof({
                lowerEndpointDigest: lowerEndpointDigest,
                roots: continuityRoots
            });
        bool verified = verifier.verifyAndEmit(
            chainKey,
            blockHeight,
            encodedTransaction,
            merkleProof,
            continuityProof
        );
        if (!verified) revert ProofVerificationFailed();

        (
            bytes32 orderId,
            bytes32 machineId,
            address payer,
            uint64 expiresAt
        ) = _validateUsagePayment(encodedTransaction);

        if (processedOrders[orderId]) revert DuplicateOrder(orderId);
        processedQueries[queryId] = true;
        processedOrders[orderId] = true;

        accessPass.grantAccess(orderId, machineId, payer, expiresAt);
        emit ProofKeyAccessActivated(queryId, orderId, machineId, payer, expiresAt);
        return true;
    }

    function _validateUsagePayment(
        bytes calldata encodedTransaction
    ) internal view returns (bytes32 orderId, bytes32 machineId, address payer, uint64 expiresAt) {
        uint8 transactionType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(transactionType)) {
            revert InvalidTransactionType(transactionType);
        }

        EvmV1Decoder.CommonTxFields memory transactionFields = EvmV1Decoder
            .decodeCommonTxFields(encodedTransaction);
        if (
            transactionFields.toIsNull ||
            transactionFields.to != sourcePaymentRegistry
        ) {
            revert WrongSourceAddress(transactionFields.to, sourcePaymentRegistry);
        }

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(
            encodedTransaction
        );
        if (receipt.receiptStatus != 1) revert FailedSourceReceipt();

        EvmV1Decoder.LogEntry[] memory usageLogs = EvmV1Decoder
            .getLogsByEventSignature(receipt, USAGE_PAID_EVENT_SIGNATURE);
        if (usageLogs.length != 1) revert InvalidEventCount(usageLogs.length);

        EvmV1Decoder.LogEntry memory usageLog = usageLogs[0];
        if (usageLog.address_ != sourcePaymentRegistry) {
            revert WrongSourceAddress(usageLog.address_, sourcePaymentRegistry);
        }
        if (usageLog.topics.length != 4 || usageLog.data.length != 128) {
            revert InvalidEventTopics();
        }

        orderId = usageLog.topics[1];
        machineId = usageLog.topics[2];
        payer = address(uint160(uint256(usageLog.topics[3])));
        if (payer == address(0)) revert InvalidPayer();
        if (payer != transactionFields.from) {
            revert PayerMismatch(payer, transactionFields.from);
        }

        (
            address beneficiary,
            uint64 startTime,
            uint64 duration,
            uint256 amount
        ) = abi.decode(usageLog.data, (address, uint64, uint64, uint256));

        (
            address machineOwner,
            ,
            ,
            uint128 tariff,
            bool active
        ) = machineRegistry.machines(machineId);
        if (machineOwner == address(0) || !active) revert InvalidMachine(machineId);
        if (beneficiary != machineOwner) {
            revert WrongBeneficiary(beneficiary, machineOwner);
        }
        if (duration == 0 || duration > MAX_DURATION) revert InvalidDuration(duration);

        uint256 expectedAmount = uint256(tariff) * duration;
        if (amount != expectedAmount) revert InvalidAmount(amount, expectedAmount);
        if (startTime > type(uint64).max - duration) revert InvalidExpiry(0);

        expiresAt = startTime + duration;
        if (expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);
    }

    /// @dev Query-id algorithm is kept compatible with the official ASCBase implementation.
    function _computeQueryId(
        uint64 chainKey,
        uint64 blockHeight,
        INativeQueryVerifier.MerkleProof memory merkleProof
    ) internal view returns (bytes32 queryId) {
        uint256 transactionIndex = verifier.calculateTxIndex(merkleProof);

        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), transactionIndex)
            queryId := keccak256(ptr, 72)
        }
    }
}
