import { expect } from "chai";
import { ethers } from "hardhat";
import { EscrowManager, UserRegistry, P2PTransfer, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Integration Tests", function () {
    let escrowManager: EscrowManager;
    let userRegistry: UserRegistry;
    let p2pTransfer: P2PTransfer;
    let token: MockERC20;
    let owner: SignerWithAddress;
    let operator: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let feeCollector: SignerWithAddress;

    const INITIAL_BALANCE = ethers.parseUnits("10000", 6);

    beforeEach(async function () {
        [owner, operator, user1, user2, feeCollector] = await ethers.getSigners();

        // Deploy UserRegistry
        const UserRegistry = await ethers.getContractFactory("UserRegistry");
        userRegistry = await UserRegistry.deploy();
        await userRegistry.waitForDeployment();

        // Deploy MockERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("USD Tether", "USDT", 6);
        await token.waitForDeployment();

        // Deploy EscrowManager
        const EscrowManager = await ethers.getContractFactory("EscrowManager");
        escrowManager = await EscrowManager.deploy(feeCollector.address);
        await escrowManager.waitForDeployment();

        // Deploy P2PTransfer
        const P2PTransfer = await ethers.getContractFactory("P2PTransfer");
        p2pTransfer = await P2PTransfer.deploy(
            await userRegistry.getAddress(),
            feeCollector.address
        );
        await p2pTransfer.waitForDeployment();

        // Setup
        await escrowManager.addOperator(operator.address);
        await token.mint(operator.address, INITIAL_BALANCE);
        await token.mint(user1.address, INITIAL_BALANCE);
        await token.mint(user2.address, INITIAL_BALANCE);
    });

    describe("UserRegistry + P2PTransfer", function () {
        it("Should send tokens immediately to registered user", async function () {
            await userRegistry.connect(user2).registerUsername("receiver123");
            await token.connect(user1).approve(await p2pTransfer.getAddress(), INITIAL_BALANCE);

            const amount = ethers.parseUnits("100", 6);
            const balanceBefore = await token.balanceOf(user2.address);

            await p2pTransfer.connect(user1).sendToUsername(
                "receiver123",
                await token.getAddress(),
                amount,
                "Test transfer"
            );

            const balanceAfter = await token.balanceOf(user2.address);
            const fee = (amount * 25n) / 10000n;
            expect(balanceAfter - balanceBefore).to.equal(amount - fee);
        });

        it("Should claim pending transfers after registration", async function () {
            await token.connect(user1).approve(await p2pTransfer.getAddress(), INITIAL_BALANCE);

            const amount = ethers.parseUnits("100", 6);
            await p2pTransfer.connect(user1).sendToUsername(
                "newuser2024",
                await token.getAddress(),
                amount,
                "Welcome gift"
            );

            // Register username now
            await userRegistry.connect(user2).registerUsername("newuser2024");

            const balanceBefore = await token.balanceOf(user2.address);
            await p2pTransfer.connect(user2).claimPendingTransfers();

            const balanceAfter = await token.balanceOf(user2.address);
            const fee = (amount * 25n) / 10000n;
            expect(balanceAfter - balanceBefore).to.equal(amount - fee);
        });
    });

    describe("UserRegistry + EscrowManager", function () {
        it("Should track escrows and username registrations separately", async function () {
            // User registers username
            await userRegistry.connect(user1).registerUsername("escrowuser");
            expect(await userRegistry.hasUsername(user1.address)).to.be.true;

            // Operator creates escrow for user
            await token.connect(operator).approve(await escrowManager.getAddress(), INITIAL_BALANCE);
            const amount = ethers.parseUnits("500", 6);

            await escrowManager.connect(operator).createBuyEscrow(
                user1.address,
                await token.getAddress(),
                amount,
                80000,
                "PAY-123"
            );

            const escrow = await escrowManager.getEscrow(1);
            expect(escrow.user).to.equal(user1.address);

            // Username is still registered
            expect(await userRegistry.getUsernameByAddress(user1.address)).to.equal("escrowuser");
        });
    });

    describe("Fee Collection", function () {
        it("Should collect fees from both P2PTransfer and EscrowManager", async function () {
            const feeBalanceBefore = await token.balanceOf(feeCollector.address);

            // P2PTransfer fee
            await userRegistry.connect(user2).registerUsername("feetest123");
            await token.connect(user1).approve(await p2pTransfer.getAddress(), INITIAL_BALANCE);
            const p2pAmount = ethers.parseUnits("100", 6);
            await p2pTransfer.connect(user1).sendToUsername(
                "feetest123",
                await token.getAddress(),
                p2pAmount,
                "Test"
            );

            // EscrowManager fee
            await token.connect(operator).approve(await escrowManager.getAddress(), INITIAL_BALANCE);
            const escrowAmount = ethers.parseUnits("200", 6);
            await escrowManager.connect(operator).createBuyEscrow(
                user1.address,
                await token.getAddress(),
                escrowAmount,
                32000,
                "PAY-456"
            );
            await escrowManager.connect(operator).releaseEscrow(1);

            const feeBalanceAfter = await token.balanceOf(feeCollector.address);
            const p2pFee = (p2pAmount * 25n) / 10000n;
            const escrowFee = (escrowAmount * 50n) / 10000n;

            expect(feeBalanceAfter - feeBalanceBefore).to.equal(p2pFee + escrowFee);
        });
    });

    describe("Multi-Contract Workflow", function () {
        it("Should handle full user onboarding flow", async function () {
            // 1. User receives pending P2P transfer
            await token.connect(user1).approve(await p2pTransfer.getAddress(), INITIAL_BALANCE);
            await p2pTransfer.connect(user1).sendToUsername(
                "newmember123",
                await token.getAddress(),
                ethers.parseUnits("50", 6),
                "Welcome bonus"
            );

            // 2. User registers username
            await userRegistry.connect(user2).registerUsername("newmember123");

            // 3. User claims pending transfers
            await p2pTransfer.connect(user2).claimPendingTransfers();

            // 4. User creates sell escrow with received tokens
            await token.connect(user2).approve(await escrowManager.getAddress(), INITIAL_BALANCE);
            await escrowManager.connect(user2).createSellEscrow(
                await token.getAddress(),
                ethers.parseUnits("25", 6),
                4000,
                "PAY-NEW"
            );

            const escrow = await escrowManager.getEscrow(1);
            expect(escrow.user).to.equal(user2.address);
            expect(escrow.escrowType).to.equal(1); // SELL
        });
    });
});
