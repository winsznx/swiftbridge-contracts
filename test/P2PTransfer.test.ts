import { expect } from "chai";
import { ethers } from "hardhat";
import { P2PTransfer, UserRegistry, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("P2PTransfer", function () {
    let p2pTransfer: P2PTransfer;
    let userRegistry: UserRegistry;
    let token: MockERC20;
    let owner: SignerWithAddress;
    let sender: SignerWithAddress;
    let recipient: SignerWithAddress;
    let feeCollector: SignerWithAddress;

    const INITIAL_BALANCE = ethers.parseUnits("10000", 6); // 10000 USDT
    const TRANSFER_AMOUNT = ethers.parseUnits("100", 6); // 100 USDT

    beforeEach(async function () {
        [owner, sender, recipient, feeCollector] = await ethers.getSigners();

        // Deploy UserRegistry
        const UserRegistry = await ethers.getContractFactory("UserRegistry");
        userRegistry = await UserRegistry.deploy();
        await userRegistry.waitForDeployment();

        // Deploy mock token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("USD Tether", "USDT", 6);
        await token.waitForDeployment();

        // Mint tokens to sender
        await token.mint(sender.address, INITIAL_BALANCE);

        // Deploy P2PTransfer
        const P2PTransfer = await ethers.getContractFactory("P2PTransfer");
        p2pTransfer = await P2PTransfer.deploy(
            await userRegistry.getAddress(),
            feeCollector.address
        );
        await p2pTransfer.waitForDeployment();

        // Approve P2PTransfer to spend sender's tokens
        await token.connect(sender).approve(await p2pTransfer.getAddress(), INITIAL_BALANCE);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await p2pTransfer.owner()).to.equal(owner.address);
        });

        it("Should set the right user registry", async function () {
            expect(await p2pTransfer.userRegistry()).to.equal(await userRegistry.getAddress());
        });

        it("Should set the right fee collector", async function () {
            expect(await p2pTransfer.feeCollector()).to.equal(feeCollector.address);
        });

        it("Should have correct default fee", async function () {
            expect(await p2pTransfer.feeBps()).to.equal(25); // 0.25%
        });

        it("Should revert if user registry is zero address", async function () {
            const P2PTransfer = await ethers.getContractFactory("P2PTransfer");
            await expect(
                P2PTransfer.deploy(ethers.ZeroAddress, feeCollector.address)
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });

        it("Should revert if fee collector is zero address", async function () {
            const P2PTransfer = await ethers.getContractFactory("P2PTransfer");
            await expect(
                P2PTransfer.deploy(await userRegistry.getAddress(), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });
    });

    describe("Send to Registered Username", function () {
        const recipientUsername = "recipient123";
        const message = "Hello from sender!";

        beforeEach(async function () {
            // Register recipient's username
            await userRegistry.connect(recipient).registerUsername(recipientUsername);
        });

        it("Should send tokens to registered username immediately", async function () {
            const recipientBalanceBefore = await token.balanceOf(recipient.address);

            await expect(
                p2pTransfer.connect(sender).sendToUsername(
                    recipientUsername,
                    await token.getAddress(),
                    TRANSFER_AMOUNT,
                    message
                )
            ).to.emit(p2pTransfer, "TransferSent");

            const recipientBalanceAfter = await token.balanceOf(recipient.address);
            const fee = (TRANSFER_AMOUNT * 25n) / 10000n;
            const expectedAmount = TRANSFER_AMOUNT - fee;

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(expectedAmount);
        });

        it("Should collect fee on transfer", async function () {
            const feeBalanceBefore = await token.balanceOf(feeCollector.address);

            await p2pTransfer.connect(sender).sendToUsername(
                recipientUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const feeBalanceAfter = await token.balanceOf(feeCollector.address);
            const expectedFee = (TRANSFER_AMOUNT * 25n) / 10000n;

            expect(feeBalanceAfter - feeBalanceBefore).to.equal(expectedFee);
        });

        it("Should mark transfer as claimed when sent to registered user", async function () {
            await p2pTransfer.connect(sender).sendToUsername(
                recipientUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const transfer = await p2pTransfer.getTransfer(1);
            expect(transfer.claimed).to.be.true;
            expect(transfer.toAddress).to.equal(recipient.address);
        });

        it("Should record transfer in sent transfers", async function () {
            await p2pTransfer.connect(sender).sendToUsername(
                recipientUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const sentTransfers = await p2pTransfer.getSentTransfers(sender.address);
            expect(sentTransfers.length).to.equal(1);
            expect(sentTransfers[0].id).to.equal(1);
        });

        it("Should record transfer in received transfers", async function () {
            await p2pTransfer.connect(sender).sendToUsername(
                recipientUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const receivedTransfers = await p2pTransfer.getReceivedTransfers(recipient.address);
            expect(receivedTransfers.length).to.equal(1);
            expect(receivedTransfers[0].id).to.equal(1);
        });

        it("Should revert on zero token address", async function () {
            await expect(
                p2pTransfer.connect(sender).sendToUsername(
                    recipientUsername,
                    ethers.ZeroAddress,
                    TRANSFER_AMOUNT,
                    message
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });

        it("Should revert on zero amount", async function () {
            await expect(
                p2pTransfer.connect(sender).sendToUsername(
                    recipientUsername,
                    await token.getAddress(),
                    0,
                    message
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAmount");
        });
    });

    describe("Send to Unregistered Username", function () {
        const unregisteredUsername = "newuser2024";
        const message = "Welcome gift!";

        it("Should create pending transfer for unregistered username", async function () {
            await p2pTransfer.connect(sender).sendToUsername(
                unregisteredUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const transfer = await p2pTransfer.getTransfer(1);
            expect(transfer.claimed).to.be.false;
            expect(transfer.toAddress).to.equal(ethers.ZeroAddress);
            expect(transfer.toUsername).to.equal(unregisteredUsername);
        });

        it("Should hold tokens in contract for pending transfer", async function () {
            const contractAddress = await p2pTransfer.getAddress();
            const balanceBefore = await token.balanceOf(contractAddress);

            await p2pTransfer.connect(sender).sendToUsername(
                unregisteredUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const balanceAfter = await token.balanceOf(contractAddress);
            const fee = (TRANSFER_AMOUNT * 25n) / 10000n;
            const expectedHeld = TRANSFER_AMOUNT - fee;

            expect(balanceAfter - balanceBefore).to.equal(expectedHeld);
        });

        it("Should track pending transfers by username", async function () {
            await p2pTransfer.connect(sender).sendToUsername(
                unregisteredUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );

            const pendingCount = await p2pTransfer.getPendingTransferCount(unregisteredUsername);
            expect(pendingCount).to.equal(1);

            const pendingTransfers = await p2pTransfer.getPendingTransfers(unregisteredUsername);
            expect(pendingTransfers.length).to.equal(1);
            expect(pendingTransfers[0].amount).to.be.greaterThan(0);
        });
    });

    describe("Claim Pending Transfers", function () {
        const unregisteredUsername = "claimer2024";
        const message = "Claim me!";

        beforeEach(async function () {
            // Send tokens to unregistered username
            await p2pTransfer.connect(sender).sendToUsername(
                unregisteredUsername,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                message
            );
        });

        it("Should allow claiming pending transfers after registering username", async function () {
            // Register the username
            await userRegistry.connect(recipient).registerUsername(unregisteredUsername);

            const recipientBalanceBefore = await token.balanceOf(recipient.address);

            await p2pTransfer.connect(recipient).claimPendingTransfers();

            const recipientBalanceAfter = await token.balanceOf(recipient.address);
            const fee = (TRANSFER_AMOUNT * 25n) / 10000n;
            const expectedAmount = TRANSFER_AMOUNT - fee;

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(expectedAmount);
        });

        it("Should mark transfer as claimed after claiming", async function () {
            await userRegistry.connect(recipient).registerUsername(unregisteredUsername);
            await p2pTransfer.connect(recipient).claimPendingTransfers();

            const transfer = await p2pTransfer.getTransfer(1);
            expect(transfer.claimed).to.be.true;
            expect(transfer.toAddress).to.equal(recipient.address);
        });

        it("Should emit TransferClaimed event", async function () {
            await userRegistry.connect(recipient).registerUsername(unregisteredUsername);

            await expect(p2pTransfer.connect(recipient).claimPendingTransfers())
                .to.emit(p2pTransfer, "TransferClaimed")
                .withArgs(1, recipient.address);
        });

        it("Should revert if user has no registered username", async function () {
            await expect(
                p2pTransfer.connect(recipient).claimPendingTransfers()
            ).to.be.revertedWithCustomError(p2pTransfer, "UsernameNotRegistered");
        });

        it("Should revert if no pending transfers", async function () {
            // Register a different username
            await userRegistry.connect(recipient).registerUsername("differentuser");

            await expect(
                p2pTransfer.connect(recipient).claimPendingTransfers()
            ).to.be.revertedWithCustomError(p2pTransfer, "NoPendingTransfers");
        });

        it("Should clear pending transfers after claiming", async function () {
            await userRegistry.connect(recipient).registerUsername(unregisteredUsername);
            await p2pTransfer.connect(recipient).claimPendingTransfers();

            const pendingCount = await p2pTransfer.getPendingTransferCount(unregisteredUsername);
            expect(pendingCount).to.equal(0);
        });

        it("Should add to received transfers after claiming", async function () {
            await userRegistry.connect(recipient).registerUsername(unregisteredUsername);
            await p2pTransfer.connect(recipient).claimPendingTransfers();

            const receivedTransfers = await p2pTransfer.getReceivedTransfers(recipient.address);
            expect(receivedTransfers.length).to.equal(1);
        });
    });

    describe("Batch Transfers", function () {
        const recipients = ["user0001", "user0002", "user0003"];
        const amounts = [
            ethers.parseUnits("50", 6),
            ethers.parseUnits("75", 6),
            ethers.parseUnits("100", 6)
        ];
        const messages = ["Message 1", "Message 2", "Message 3"];

        beforeEach(async function () {
            // Register first recipient
            await userRegistry.connect(recipient).registerUsername(recipients[0]);
        });

        it("Should batch send to multiple usernames", async function () {
            await expect(
                p2pTransfer.connect(sender).batchSendToUsername(
                    recipients,
                    await token.getAddress(),
                    amounts,
                    messages
                )
            ).to.emit(p2pTransfer, "BatchTransferSent");
        });

        it("Should create correct number of transfers", async function () {
            await p2pTransfer.connect(sender).batchSendToUsername(
                recipients,
                await token.getAddress(),
                amounts,
                messages
            );

            expect(await p2pTransfer.transferCounter()).to.equal(3);
        });

        it("Should transfer immediately to registered users", async function () {
            const recipientBalanceBefore = await token.balanceOf(recipient.address);

            await p2pTransfer.connect(sender).batchSendToUsername(
                recipients,
                await token.getAddress(),
                amounts,
                messages
            );

            const recipientBalanceAfter = await token.balanceOf(recipient.address);
            const fee = (amounts[0] * 25n) / 10000n;
            const expectedAmount = amounts[0] - fee;

            expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(expectedAmount);
        });

        it("Should create pending transfers for unregistered users", async function () {
            await p2pTransfer.connect(sender).batchSendToUsername(
                recipients,
                await token.getAddress(),
                amounts,
                messages
            );

            // Check pending for unregistered users
            const pending1 = await p2pTransfer.getPendingTransferCount(recipients[1]);
            const pending2 = await p2pTransfer.getPendingTransferCount(recipients[2]);

            expect(pending1).to.equal(1);
            expect(pending2).to.equal(1);
        });

        it("Should revert on mismatched array lengths", async function () {
            await expect(
                p2pTransfer.connect(sender).batchSendToUsername(
                    recipients,
                    await token.getAddress(),
                    [amounts[0]], // Wrong length
                    messages
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAmount");
        });

        it("Should revert on zero token address", async function () {
            await expect(
                p2pTransfer.connect(sender).batchSendToUsername(
                    recipients,
                    ethers.ZeroAddress,
                    amounts,
                    messages
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });

        it("Should revert if any amount is zero", async function () {
            await expect(
                p2pTransfer.connect(sender).batchSendToUsername(
                    recipients,
                    await token.getAddress(),
                    [amounts[0], 0n, amounts[2]], // Zero amount
                    messages
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAmount");
        });

        it("Should collect fees for all batch transfers", async function () {
            const feeBalanceBefore = await token.balanceOf(feeCollector.address);

            await p2pTransfer.connect(sender).batchSendToUsername(
                recipients,
                await token.getAddress(),
                amounts,
                messages
            );

            const feeBalanceAfter = await token.balanceOf(feeCollector.address);

            let totalExpectedFee = 0n;
            for (const amount of amounts) {
                totalExpectedFee += (amount * 25n) / 10000n;
            }

            expect(feeBalanceAfter - feeBalanceBefore).to.equal(totalExpectedFee);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to set user registry", async function () {
            const newRegistry = recipient.address;
            await p2pTransfer.setUserRegistry(newRegistry);
            expect(await p2pTransfer.userRegistry()).to.equal(newRegistry);
        });

        it("Should revert setting zero address for user registry", async function () {
            await expect(
                p2pTransfer.setUserRegistry(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });

        it("Should allow owner to set fee", async function () {
            await p2pTransfer.setFee(50);
            expect(await p2pTransfer.feeBps()).to.equal(50);
        });

        it("Should emit FeeUpdated event", async function () {
            await expect(p2pTransfer.setFee(50))
                .to.emit(p2pTransfer, "FeeUpdated")
                .withArgs(50);
        });

        it("Should reject fee greater than 5%", async function () {
            await expect(p2pTransfer.setFee(501)).to.be.revertedWithCustomError(
                p2pTransfer,
                "InvalidFee"
            );
        });

        it("Should allow owner to set fee collector", async function () {
            await p2pTransfer.setFeeCollector(recipient.address);
            expect(await p2pTransfer.feeCollector()).to.equal(recipient.address);
        });

        it("Should emit FeeCollectorUpdated event", async function () {
            await expect(p2pTransfer.setFeeCollector(recipient.address))
                .to.emit(p2pTransfer, "FeeCollectorUpdated")
                .withArgs(recipient.address);
        });

        it("Should revert setting zero address for fee collector", async function () {
            await expect(
                p2pTransfer.setFeeCollector(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(p2pTransfer, "InvalidAddress");
        });

        it("Should reject non-owner admin calls", async function () {
            await expect(
                p2pTransfer.connect(sender).setFee(50)
            ).to.be.revertedWithCustomError(p2pTransfer, "OwnableUnauthorizedAccount");

            await expect(
                p2pTransfer.connect(sender).setFeeCollector(recipient.address)
            ).to.be.revertedWithCustomError(p2pTransfer, "OwnableUnauthorizedAccount");

            await expect(
                p2pTransfer.connect(sender).setUserRegistry(recipient.address)
            ).to.be.revertedWithCustomError(p2pTransfer, "OwnableUnauthorizedAccount");
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause", async function () {
            await p2pTransfer.pause();
            expect(await p2pTransfer.paused()).to.be.true;
        });

        it("Should prevent transfers when paused", async function () {
            await userRegistry.connect(recipient).registerUsername("testuser123");
            await p2pTransfer.pause();

            await expect(
                p2pTransfer.connect(sender).sendToUsername(
                    "testuser123",
                    await token.getAddress(),
                    TRANSFER_AMOUNT,
                    "test"
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "EnforcedPause");
        });

        it("Should prevent batch transfers when paused", async function () {
            await p2pTransfer.pause();

            await expect(
                p2pTransfer.connect(sender).batchSendToUsername(
                    ["user1"],
                    await token.getAddress(),
                    [TRANSFER_AMOUNT],
                    ["test"]
                )
            ).to.be.revertedWithCustomError(p2pTransfer, "EnforcedPause");
        });

        it("Should allow owner to unpause", async function () {
            await p2pTransfer.pause();
            await p2pTransfer.unpause();
            expect(await p2pTransfer.paused()).to.be.false;
        });

        it("Should reject non-owner pause", async function () {
            await expect(
                p2pTransfer.connect(sender).pause()
            ).to.be.revertedWithCustomError(p2pTransfer, "OwnableUnauthorizedAccount");
        });

        it("Should reject non-owner unpause", async function () {
            await p2pTransfer.pause();
            await expect(
                p2pTransfer.connect(sender).unpause()
            ).to.be.revertedWithCustomError(p2pTransfer, "OwnableUnauthorizedAccount");
        });
    });

    describe("View Functions", function () {
        const username = "viewtestuser";

        beforeEach(async function () {
            await userRegistry.connect(recipient).registerUsername(username);

            // Create some transfers
            await p2pTransfer.connect(sender).sendToUsername(
                username,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                "Transfer 1"
            );
            await p2pTransfer.connect(sender).sendToUsername(
                username,
                await token.getAddress(),
                TRANSFER_AMOUNT,
                "Transfer 2"
            );
        });

        it("Should get transfer by ID", async function () {
            const transfer = await p2pTransfer.getTransfer(1);
            expect(transfer.id).to.equal(1);
            expect(transfer.from).to.equal(sender.address);
            expect(transfer.toUsername).to.equal(username);
        });

        it("Should get sent transfers for address", async function () {
            const sentTransfers = await p2pTransfer.getSentTransfers(sender.address);
            expect(sentTransfers.length).to.equal(2);
        });

        it("Should get received transfers for address", async function () {
            const receivedTransfers = await p2pTransfer.getReceivedTransfers(recipient.address);
            expect(receivedTransfers.length).to.equal(2);
        });

        it("Should return empty arrays for addresses with no transfers", async function () {
            const sent = await p2pTransfer.getSentTransfers(feeCollector.address);
            const received = await p2pTransfer.getReceivedTransfers(feeCollector.address);

            expect(sent.length).to.equal(0);
            expect(received.length).to.equal(0);
        });
    });
});
