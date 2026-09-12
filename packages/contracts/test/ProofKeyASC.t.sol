// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {AccessPass} from "../contracts/AccessPass.sol";
import {MachineRegistry} from "../contracts/MachineRegistry.sol";
import {ProofKeyASC} from "../contracts/ProofKeyASC.sol";

interface VmProofKey {
    function etch(address target, bytes calldata code) external;
    function expectPartialRevert(bytes4 revertData) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function warp(uint256 timestamp) external;
}

contract AcceptingNativeQueryVerifier {
    function calculateTxIndex(
        INativeQueryVerifier.MerkleProof calldata
    ) external pure returns (uint64) {
        return 0;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external pure returns (bool) {
        return true;
    }
}

contract RejectingNativeQueryVerifier {
    function calculateTxIndex(
        INativeQueryVerifier.MerkleProof calldata
    ) external pure returns (uint64) {
        return 0;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external pure returns (bool) {
        return false;
    }
}

/// @dev Test-only verifier that binds every proof field together deterministically.
/// It exercises ProofKeyASC's fail-closed boundary; it is not live-precompile evidence.
contract ProofBindingNativeQueryVerifier {
    function calculateTxIndex(
        INativeQueryVerifier.MerkleProof calldata proof
    ) external pure returns (uint64) {
        return uint64(uint256(proof.root));
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external pure returns (bool) {
        if (merkleProof.siblings.length != 1 || continuityProof.roots.length != 1) {
            return false;
        }

        bytes32 expectedRoot = keccak256(encodedTransaction);
        bytes32 expectedSibling = keccak256(abi.encode(expectedRoot));
        bytes32 expectedLowerEndpoint = keccak256(
            abi.encode(chainKey, blockHeight, expectedRoot)
        );
        bytes32 expectedContinuityRoot = keccak256(
            abi.encode(expectedLowerEndpoint, expectedSibling)
        );

        return
            merkleProof.root == expectedRoot &&
            merkleProof.siblings[0].hash == expectedSibling &&
            merkleProof.siblings[0].isLeft &&
            continuityProof.lowerEndpointDigest == expectedLowerEndpoint &&
            continuityProof.roots[0] == expectedContinuityRoot;
    }
}

/// @notice Local security tests using test doubles etched over precompile 0x0FD2.
/// @dev Live Creditcoin precompile evidence is deliberately kept outside this suite.
contract ProofKeyASCTest {
    struct UsageFixture {
        address transactionTo;
        address transactionSender;
        address logEmitter;
        bytes32 eventSignature;
        bytes32 orderId;
        bytes32 machineId;
        address payer;
        address beneficiary;
        uint64 startTime;
        uint64 duration;
        uint256 amount;
        uint8 receiptStatus;
    }

    struct BoundProof {
        bytes32 merkleRoot;
        bytes32 siblingHash;
        bytes32 lowerEndpointDigest;
        bytes32 continuityRoot;
    }

    VmProofKey private constant vm =
        VmProofKey(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant VERIFIER_PRECOMPILE =
        0x0000000000000000000000000000000000000FD2;
    address private constant SOURCE_PAYMENT_REGISTRY = address(0x5150);
    address private constant CONTROLLER = address(0xC071);
    address private constant PAYER = address(0xA11CE);
    address private constant OTHER_USER = address(0xB0B);
    bytes32 private constant MACHINE_ID = keccak256("proofkey.excavator.001");
    bytes32 private constant ORDER_ID = keccak256("source-order-001");
    bytes32 private constant METADATA_HASH = keccak256("ipfs://excavator-metadata");
    uint128 private constant TARIFF = 2_500;
    uint64 private constant CURRENT_TIME = 1_800_000_000;
    uint64 private constant DURATION = 3_600;
    uint64 private constant BLOCK_HEIGHT = 11_500_000;
    bytes32 private constant MERKLE_ROOT = keccak256("proof-root-001");
    uint8 private constant AUTHORIZE_ACCESS_ACTION = 0;
    uint64 private constant SEPOLIA_CHAIN_KEY = 1;
    bytes32 private constant USAGE_PAID_EVENT_SIGNATURE =
        keccak256(
            "UsagePaid(bytes32,bytes32,address,address,uint64,uint64,uint256)"
        );

    MachineRegistry private machineRegistry;
    AccessPass private accessPass;
    ProofKeyASC private proofKey;

    function setUp() public {
        AcceptingNativeQueryVerifier acceptingVerifier = new AcceptingNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(acceptingVerifier).code);

        machineRegistry = new MachineRegistry();
        machineRegistry.registerMachine(
            MACHINE_ID,
            CONTROLLER,
            METADATA_HASH,
            TARIFF,
            true
        );
        accessPass = new AccessPass(address(machineRegistry), address(0));
        proofKey = new ProofKeyASC(
            SOURCE_PAYMENT_REGISTRY,
            address(machineRegistry),
            address(accessPass)
        );
        accessPass.setAttestcoinAuthorizer(address(proofKey));
        vm.warp(CURRENT_TIME);
    }

    function test_ValidProofActivatesCorrectAccessPass() public {
        UsageFixture memory usage = _validUsage();

        bool success = _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));

        require(success, "execute did not succeed");
        require(accessPass.isAuthorized(MACHINE_ID, PAYER), "payer not authorized");
        require(!accessPass.isAuthorized(MACHINE_ID, OTHER_USER), "wrong user authorized");
        (bytes32 authorizationId, uint64 expiresAt) = accessPass.accessCredentials(
            MACHINE_ID,
            PAYER
        );
        require(authorizationId == ORDER_ID, "wrong authorization id");
        require(expiresAt == CURRENT_TIME + DURATION, "wrong expiry");
        require(proofKey.processedOrders(ORDER_ID), "order replay guard not set");
    }

    function test_RevertForWrongSourceChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                ProofKeyASC.WrongSourceChain.selector,
                uint64(3),
                SEPOLIA_CHAIN_KEY
            )
        );
        _execute(3, MERKLE_ROOT, _encode(_validUsage()));
        _assertNoDefaultAccess();
    }

    function test_RevertForWrongTransactionSourceAddress() public {
        UsageFixture memory usage = _validUsage();
        usage.transactionTo = address(0xBAD);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProofKeyASC.WrongSourceAddress.selector,
                address(0xBAD),
                SOURCE_PAYMENT_REGISTRY
            )
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForWrongLogEmitter() public {
        UsageFixture memory usage = _validUsage();
        usage.logEmitter = address(0xBAD);

        vm.expectRevert(
            abi.encodeWithSelector(
                ProofKeyASC.WrongSourceAddress.selector,
                address(0xBAD),
                SOURCE_PAYMENT_REGISTRY
            )
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForWrongEventSignature() public {
        UsageFixture memory usage = _validUsage();
        usage.eventSignature = keccak256("OtherEvent(bytes32)");

        vm.expectRevert(abi.encodeWithSelector(ProofKeyASC.InvalidEventCount.selector, 0));
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForWrongPayer() public {
        UsageFixture memory usage = _validUsage();
        usage.payer = OTHER_USER;

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.PayerMismatch.selector, OTHER_USER, PAYER)
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
        _assertNoAccess(MACHINE_ID, OTHER_USER, ORDER_ID);
    }

    function test_RevertForWrongBeneficiary() public {
        UsageFixture memory usage = _validUsage();
        usage.beneficiary = OTHER_USER;

        vm.expectRevert(
            abi.encodeWithSelector(
                ProofKeyASC.WrongBeneficiary.selector,
                OTHER_USER,
                address(this)
            )
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForUnknownMachine() public {
        UsageFixture memory usage = _validUsage();
        bytes32 unknownMachine = keccak256("unknown-machine");
        usage.machineId = unknownMachine;

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.InvalidMachine.selector, unknownMachine)
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
        _assertNoAccess(unknownMachine, PAYER, ORDER_ID);
    }

    function test_RevertForWrongAmount() public {
        UsageFixture memory usage = _validUsage();
        uint256 wrongAmount = usage.amount - 1;
        usage.amount = wrongAmount;

        vm.expectRevert(
            abi.encodeWithSelector(
                ProofKeyASC.InvalidAmount.selector,
                wrongAmount,
                uint256(TARIFF) * DURATION
            )
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForZeroDuration() public {
        UsageFixture memory usage = _validUsage();
        usage.duration = 0;

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.InvalidDuration.selector, uint64(0))
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForDurationAboveSourceMaximum() public {
        UsageFixture memory usage = _validUsage();
        usage.duration = 30 days + 1;
        usage.amount = uint256(TARIFF) * usage.duration;

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.InvalidDuration.selector, usage.duration)
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForExpiredUsageWindow() public {
        UsageFixture memory usage = _validUsage();
        usage.startTime = CURRENT_TIME - DURATION;

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.InvalidExpiry.selector, CURRENT_TIME)
        );
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertForFailedSourceReceipt() public {
        UsageFixture memory usage = _validUsage();
        usage.receiptStatus = 0;

        vm.expectRevert(ProofKeyASC.FailedSourceReceipt.selector);
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(usage));
        _assertNoDefaultAccess();
    }

    function test_RevertWhenNativeProofVerifierRejects() public {
        RejectingNativeQueryVerifier rejectingVerifier = new RejectingNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(rejectingVerifier).code);

        vm.expectRevert(ProofKeyASC.ProofVerificationFailed.selector);
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(_validUsage()));
        _assertNoDefaultAccess();
    }

    function test_ProofBindingHarnessAcceptsUntamperedEvidence() public {
        _useProofBindingVerifier();
        bytes memory encodedTransaction = _encode(_validUsage());
        BoundProof memory proof = _boundProof(encodedTransaction);

        bool success = _executeBoundProof(encodedTransaction, proof);

        require(success, "bound proof did not succeed");
        require(accessPass.isAuthorized(MACHINE_ID, PAYER), "payer not authorized");
    }

    function test_RevertForTamperedTransactionBytes() public {
        _useProofBindingVerifier();
        bytes memory encodedTransaction = _encode(_validUsage());
        BoundProof memory proof = _boundProof(encodedTransaction);
        bytes memory tamperedTransaction = bytes.concat(encodedTransaction, hex"00");

        vm.expectRevert(ProofKeyASC.ProofVerificationFailed.selector);
        _executeBoundProof(tamperedTransaction, proof);
        _assertNoDefaultAccess();
    }

    function test_RevertForTamperedMerkleRoot() public {
        _useProofBindingVerifier();
        bytes memory encodedTransaction = _encode(_validUsage());
        BoundProof memory proof = _boundProof(encodedTransaction);
        proof.merkleRoot = keccak256("tampered-merkle-root");

        vm.expectRevert(ProofKeyASC.ProofVerificationFailed.selector);
        _executeBoundProof(encodedTransaction, proof);
        _assertNoDefaultAccess();
    }

    function test_RevertForTamperedMerkleSibling() public {
        _useProofBindingVerifier();
        bytes memory encodedTransaction = _encode(_validUsage());
        BoundProof memory proof = _boundProof(encodedTransaction);
        proof.siblingHash = keccak256("tampered-merkle-sibling");

        vm.expectRevert(ProofKeyASC.ProofVerificationFailed.selector);
        _executeBoundProof(encodedTransaction, proof);
        _assertNoDefaultAccess();
    }

    function test_RevertForTamperedContinuityData() public {
        _useProofBindingVerifier();
        bytes memory encodedTransaction = _encode(_validUsage());
        BoundProof memory proof = _boundProof(encodedTransaction);
        proof.continuityRoot = keccak256("tampered-continuity-root");

        vm.expectRevert(ProofKeyASC.ProofVerificationFailed.selector);
        _executeBoundProof(encodedTransaction, proof);
        _assertNoDefaultAccess();
    }

    function test_RevertForQueryReplay() public {
        bytes memory encodedTransaction = _encode(_validUsage());
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, encodedTransaction);

        vm.expectPartialRevert(ProofKeyASC.QueryAlreadyProcessed.selector);
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, encodedTransaction);
        _assertDefaultAccessUnchanged();
    }

    function test_RevertForOrderReplayUnderDifferentQuery() public {
        bytes memory encodedTransaction = _encode(_validUsage());
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, encodedTransaction);

        vm.expectRevert(
            abi.encodeWithSelector(ProofKeyASC.DuplicateOrder.selector, ORDER_ID)
        );
        _executeAtHeight(
            SEPOLIA_CHAIN_KEY,
            BLOCK_HEIGHT + 1,
            keccak256("different-proof-root"),
            encodedTransaction
        );
        _assertDefaultAccessUnchanged();
    }

    function test_AccessReturnsFalseAtExpiry() public {
        _execute(SEPOLIA_CHAIN_KEY, MERKLE_ROOT, _encode(_validUsage()));
        require(accessPass.isAuthorized(MACHINE_ID, PAYER), "access not initially valid");

        vm.warp(CURRENT_TIME + DURATION);

        require(!accessPass.isAuthorized(MACHINE_ID, PAYER), "access survived expiry");
    }

    function test_NoAdministratorCanBypassProofVerification() public {
        vm.expectRevert(AccessPass.NotAttestcoinAuthorizer.selector);
        accessPass.grantAccess(ORDER_ID, MACHINE_ID, PAYER, CURRENT_TIME + DURATION);
        _assertNoDefaultAccess();

        AcceptingNativeQueryVerifier otherAuthorizer = new AcceptingNativeQueryVerifier();
        vm.expectRevert(AccessPass.AttestcoinAuthorizerAlreadySet.selector);
        accessPass.setAttestcoinAuthorizer(address(otherAuthorizer));
        _assertNoDefaultAccess();
    }

    function _execute(
        uint64 chainKey,
        bytes32 merkleRoot,
        bytes memory encodedTransaction
    ) internal returns (bool) {
        return _executeAtHeight(chainKey, BLOCK_HEIGHT, merkleRoot, encodedTransaction);
    }

    function _executeAtHeight(
        uint64 chainKey,
        uint64 blockHeight,
        bytes32 merkleRoot,
        bytes memory encodedTransaction
    ) internal returns (bool) {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory continuityRoots = new bytes32[](0);

        return
            proofKey.execute(
                AUTHORIZE_ACCESS_ACTION,
                chainKey,
                blockHeight,
                encodedTransaction,
                merkleRoot,
                siblings,
                bytes32(0),
                continuityRoots
            );
    }

    function _useProofBindingVerifier() internal {
        ProofBindingNativeQueryVerifier verifier = new ProofBindingNativeQueryVerifier();
        vm.etch(VERIFIER_PRECOMPILE, address(verifier).code);
    }

    function _boundProof(
        bytes memory encodedTransaction
    ) internal pure returns (BoundProof memory proof) {
        proof.merkleRoot = keccak256(encodedTransaction);
        proof.siblingHash = keccak256(abi.encode(proof.merkleRoot));
        proof.lowerEndpointDigest = keccak256(
            abi.encode(SEPOLIA_CHAIN_KEY, BLOCK_HEIGHT, proof.merkleRoot)
        );
        proof.continuityRoot = keccak256(
            abi.encode(proof.lowerEndpointDigest, proof.siblingHash)
        );
    }

    function _executeBoundProof(
        bytes memory encodedTransaction,
        BoundProof memory proof
    ) internal returns (bool) {
        INativeQueryVerifier.MerkleProofEntry[] memory siblings =
            new INativeQueryVerifier.MerkleProofEntry[](1);
        siblings[0] = INativeQueryVerifier.MerkleProofEntry({
            hash: proof.siblingHash,
            isLeft: true
        });
        bytes32[] memory continuityRoots = new bytes32[](1);
        continuityRoots[0] = proof.continuityRoot;

        return
            proofKey.execute(
                AUTHORIZE_ACCESS_ACTION,
                SEPOLIA_CHAIN_KEY,
                BLOCK_HEIGHT,
                encodedTransaction,
                proof.merkleRoot,
                siblings,
                proof.lowerEndpointDigest,
                continuityRoots
            );
    }

    function _assertNoDefaultAccess() internal view {
        _assertNoAccess(MACHINE_ID, PAYER, ORDER_ID);
    }

    function _assertNoAccess(
        bytes32 machineId,
        address beneficiary,
        bytes32 orderId
    ) internal view {
        require(!accessPass.isAuthorized(machineId, beneficiary), "invalid proof granted access");
        (bytes32 authorizationId, uint64 expiresAt) = accessPass.accessCredentials(
            machineId,
            beneficiary
        );
        require(authorizationId == bytes32(0), "invalid proof stored authorization id");
        require(expiresAt == 0, "invalid proof stored expiry");
        require(!proofKey.processedOrders(orderId), "invalid proof consumed order");
    }

    function _assertDefaultAccessUnchanged() internal view {
        require(accessPass.isAuthorized(MACHINE_ID, PAYER), "replay removed access");
        (bytes32 authorizationId, uint64 expiresAt) = accessPass.accessCredentials(
            MACHINE_ID,
            PAYER
        );
        require(authorizationId == ORDER_ID, "replay changed authorization id");
        require(expiresAt == CURRENT_TIME + DURATION, "replay changed expiry");
        require(proofKey.processedOrders(ORDER_ID), "replay cleared order guard");
    }

    function _validUsage() internal view returns (UsageFixture memory usage) {
        usage = UsageFixture({
            transactionTo: SOURCE_PAYMENT_REGISTRY,
            transactionSender: PAYER,
            logEmitter: SOURCE_PAYMENT_REGISTRY,
            eventSignature: USAGE_PAID_EVENT_SIGNATURE,
            orderId: ORDER_ID,
            machineId: MACHINE_ID,
            payer: PAYER,
            beneficiary: address(this),
            startTime: CURRENT_TIME,
            duration: DURATION,
            amount: uint256(TARIFF) * DURATION,
            receiptStatus: 1
        });
    }

    function _encode(UsageFixture memory usage) internal pure returns (bytes memory encoded) {
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = usage.eventSignature;
        topics[1] = usage.orderId;
        topics[2] = usage.machineId;
        topics[3] = bytes32(uint256(uint160(usage.payer)));

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({
            address_: usage.logEmitter,
            topics: topics,
            data: abi.encode(
                usage.beneficiary,
                usage.startTime,
                usage.duration,
                usage.amount
            )
        });

        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(
            uint64(0),
            uint64(200_000),
            usage.transactionSender,
            false,
            usage.transactionTo,
            uint256(0),
            bytes("")
        );
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(usage.receiptStatus, uint64(150_000), logs, bytes(""));

        encoded = abi.encode(uint8(0), chunks);
    }
}
