// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20PaymentToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title UsagePaymentRegistry
/// @notice Settles machine-usage payments and emits self-contained authorization evidence.
/// @dev The beneficiary and price are read from owner-managed offers, never from worker input.
contract UsagePaymentRegistry {
    struct MachineOffer {
        address beneficiary;
        uint128 pricePerSecond;
        bool active;
    }

    uint64 public constant MAX_DURATION = 30 days;

    IERC20PaymentToken public immutable paymentToken;
    address public owner;

    mapping(bytes32 machineId => MachineOffer offer) public machineOffers;
    mapping(bytes32 orderId => bool paid) public paidOrders;

    uint256 private locked = 1;

    error DuplicateOrder(bytes32 orderId);
    error InvalidBeneficiary();
    error InvalidDuration(uint64 duration);
    error InvalidMachineId();
    error InvalidPaymentNonce();
    error InvalidPaymentToken();
    error InvalidPrice();
    error MachineUnavailable(bytes32 machineId);
    error NotOwner();
    error ReentrantCall();
    error TokenTransferFailed();

    event MachineOfferSet(
        bytes32 indexed machineId,
        address indexed beneficiary,
        uint128 pricePerSecond,
        bool active
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event UsagePaid(
        bytes32 indexed orderId,
        bytes32 indexed machineId,
        address indexed payer,
        address beneficiary,
        uint64 startTime,
        uint64 duration,
        uint256 amount
    );

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert ReentrantCall();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address paymentTokenAddress) {
        if (paymentTokenAddress.code.length == 0) revert InvalidPaymentToken();

        paymentToken = IERC20PaymentToken(paymentTokenAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Creates or updates the authoritative payment terms for a machine.
    function setMachineOffer(
        bytes32 machineId,
        address beneficiary,
        uint128 pricePerSecond,
        bool active
    ) external onlyOwner {
        if (machineId == bytes32(0)) revert InvalidMachineId();
        if (beneficiary == address(0)) revert InvalidBeneficiary();
        if (pricePerSecond == 0) revert InvalidPrice();

        machineOffers[machineId] = MachineOffer({
            beneficiary: beneficiary,
            pricePerSecond: pricePerSecond,
            active: active
        });

        emit MachineOfferSet(machineId, beneficiary, pricePerSecond, active);
    }

    /// @notice Enables or disables an existing machine without changing its commercial terms.
    function setMachineActive(bytes32 machineId, bool active) external onlyOwner {
        MachineOffer storage offer = machineOffers[machineId];
        if (offer.beneficiary == address(0)) revert MachineUnavailable(machineId);

        offer.active = active;
        emit MachineOfferSet(machineId, offer.beneficiary, offer.pricePerSecond, active);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidBeneficiary();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @notice Computes the replay-protected identifier used by both the contract and indexers.
    function computeOrderId(
        bytes32 machineId,
        address payer,
        bytes32 paymentNonce
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), machineId, payer, paymentNonce));
    }

    /// @notice Pays for a usage window and emits the complete cross-chain authorization record.
    function payForUsage(
        bytes32 machineId,
        uint64 duration,
        bytes32 paymentNonce
    ) external nonReentrant returns (bytes32 orderId) {
        MachineOffer memory offer = machineOffers[machineId];
        if (!offer.active) revert MachineUnavailable(machineId);
        if (duration == 0 || duration > MAX_DURATION) revert InvalidDuration(duration);
        if (paymentNonce == bytes32(0)) revert InvalidPaymentNonce();

        orderId = computeOrderId(machineId, msg.sender, paymentNonce);
        if (paidOrders[orderId]) revert DuplicateOrder(orderId);

        uint256 amount = uint256(offer.pricePerSecond) * duration;
        paidOrders[orderId] = true;

        (bool success, bytes memory result) = address(paymentToken).call(
            abi.encodeCall(
                IERC20PaymentToken.transferFrom,
                (msg.sender, offer.beneficiary, amount)
            )
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed();
        }

        emit UsagePaid(
            orderId,
            machineId,
            msg.sender,
            offer.beneficiary,
            uint64(block.timestamp),
            duration,
            amount
        );
    }
}
