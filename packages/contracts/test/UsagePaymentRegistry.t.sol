// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UsagePaymentRegistry} from "../contracts/UsagePaymentRegistry.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract UsagePaymentRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant MACHINE_ID = keccak256("proofkey.excavator.001");
    bytes32 private constant PAYMENT_NONCE = keccak256("payer-session-001");
    address private constant PAYER = address(0xA11CE);
    address private constant BENEFICIARY = address(0xBEEF);
    uint128 private constant PRICE_PER_SECOND = 2_500;
    uint64 private constant DURATION = 3_600;
    uint64 private constant START_TIME = 1_800_000_000;

    MockUSDC private token;
    UsagePaymentRegistry private registry;

    event UsagePaid(
        bytes32 indexed orderId,
        bytes32 indexed machineId,
        address indexed payer,
        address beneficiary,
        uint64 startTime,
        uint64 duration,
        uint256 amount
    );

    function setUp() public {
        token = new MockUSDC();
        registry = new UsagePaymentRegistry(address(token));
        registry.setMachineOffer(MACHINE_ID, BENEFICIARY, PRICE_PER_SECOND, true);

        token.mint(PAYER, 1_000_000_000);
        vm.prank(PAYER);
        token.approve(address(registry), type(uint256).max);
        vm.warp(START_TIME);
    }

    function test_ValidPaymentSettlesAndEmitsCompleteAuthorizationEvidence() public {
        uint256 amount = uint256(PRICE_PER_SECOND) * DURATION;
        bytes32 expectedOrderId = registry.computeOrderId(MACHINE_ID, PAYER, PAYMENT_NONCE);

        vm.expectEmit(true, true, true, true);
        emit UsagePaid(
            expectedOrderId,
            MACHINE_ID,
            PAYER,
            BENEFICIARY,
            START_TIME,
            DURATION,
            amount
        );

        vm.prank(PAYER);
        bytes32 orderId = registry.payForUsage(MACHINE_ID, DURATION, PAYMENT_NONCE);

        require(orderId == expectedOrderId, "unexpected order id");
        require(registry.paidOrders(orderId), "order not recorded");
        require(token.balanceOf(BENEFICIARY) == amount, "beneficiary not paid");
        require(token.balanceOf(PAYER) == 1_000_000_000 - amount, "payer balance incorrect");
    }

    function test_OrderIdIsDeterministicAndDomainSeparated() public view {
        bytes32 first = registry.computeOrderId(MACHINE_ID, PAYER, PAYMENT_NONCE);
        bytes32 second = registry.computeOrderId(MACHINE_ID, PAYER, PAYMENT_NONCE);
        bytes32 otherMachine = registry.computeOrderId(keccak256("another-machine"), PAYER, PAYMENT_NONCE);

        require(first == second, "order id is not deterministic");
        require(first != otherMachine, "machine id is not in domain");
    }

    function test_RevertWhenMachineIdIsZero() public {
        vm.expectRevert(UsagePaymentRegistry.InvalidMachineId.selector);
        registry.setMachineOffer(bytes32(0), BENEFICIARY, PRICE_PER_SECOND, true);
    }

    function test_RevertWhenBeneficiaryIsZero() public {
        vm.expectRevert(UsagePaymentRegistry.InvalidBeneficiary.selector);
        registry.setMachineOffer(MACHINE_ID, address(0), PRICE_PER_SECOND, true);
    }

    function test_RevertWhenPriceIsZero() public {
        vm.expectRevert(UsagePaymentRegistry.InvalidPrice.selector);
        registry.setMachineOffer(MACHINE_ID, BENEFICIARY, 0, true);
    }

    function test_RevertWhenNonOwnerConfiguresOffer() public {
        vm.expectRevert(UsagePaymentRegistry.NotOwner.selector);
        vm.prank(PAYER);
        registry.setMachineOffer(MACHINE_ID, BENEFICIARY, PRICE_PER_SECOND, true);
    }

    function test_RevertWhenMachineIsUnknown() public {
        bytes32 unknownMachine = keccak256("unknown-machine");

        vm.expectRevert(
            abi.encodeWithSelector(UsagePaymentRegistry.MachineUnavailable.selector, unknownMachine)
        );
        vm.prank(PAYER);
        registry.payForUsage(unknownMachine, DURATION, PAYMENT_NONCE);
    }

    function test_RevertWhenMachineIsInactive() public {
        registry.setMachineActive(MACHINE_ID, false);

        vm.expectRevert(
            abi.encodeWithSelector(UsagePaymentRegistry.MachineUnavailable.selector, MACHINE_ID)
        );
        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, DURATION, PAYMENT_NONCE);
    }

    function test_RevertWhenDurationIsZero() public {
        vm.expectRevert(
            abi.encodeWithSelector(UsagePaymentRegistry.InvalidDuration.selector, uint64(0))
        );
        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, 0, PAYMENT_NONCE);
    }

    function test_RevertWhenDurationExceedsMaximum() public {
        uint64 invalidDuration = registry.MAX_DURATION() + 1;

        vm.expectRevert(
            abi.encodeWithSelector(UsagePaymentRegistry.InvalidDuration.selector, invalidDuration)
        );
        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, invalidDuration, PAYMENT_NONCE);
    }

    function test_RevertWhenPaymentNonceIsZero() public {
        vm.expectRevert(UsagePaymentRegistry.InvalidPaymentNonce.selector);
        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, DURATION, bytes32(0));
    }

    function test_RevertWhenOrderIsDuplicate() public {
        bytes32 orderId = registry.computeOrderId(MACHINE_ID, PAYER, PAYMENT_NONCE);

        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, DURATION, PAYMENT_NONCE);

        vm.expectRevert(
            abi.encodeWithSelector(UsagePaymentRegistry.DuplicateOrder.selector, orderId)
        );
        vm.prank(PAYER);
        registry.payForUsage(MACHINE_ID, DURATION, PAYMENT_NONCE);
    }

    function test_RevertWhenTokenPaymentFails() public {
        address unfundedPayer = address(0xBAD);

        vm.prank(unfundedPayer);
        token.approve(address(registry), type(uint256).max);

        vm.expectRevert(UsagePaymentRegistry.TokenTransferFailed.selector);
        vm.prank(unfundedPayer);
        registry.payForUsage(MACHINE_ID, DURATION, PAYMENT_NONCE);
    }
}
