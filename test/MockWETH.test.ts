import { expect } from "chai";
import { ethers } from "hardhat";
import { MockWETH } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MockWETH", function () {
    let weth: MockWETH;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;

    const DEPOSIT_AMOUNT = ethers.parseEther("10");

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        const MockWETH = await ethers.getContractFactory("MockWETH");
        weth = await MockWETH.deploy();
        await weth.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set correct name", async function () {
            expect(await weth.name()).to.equal("Wrapped Ether");
        });

        it("Should set correct symbol", async function () {
            expect(await weth.symbol()).to.equal("WETH");
        });

        it("Should have 18 decimals", async function () {
            expect(await weth.decimals()).to.equal(18);
        });

        it("Should have zero initial supply", async function () {
            expect(await weth.totalSupply()).to.equal(0);
        });
    });

    describe("Deposit", function () {
        it("Should mint WETH on deposit", async function () {
            await weth.connect(user).deposit({ value: DEPOSIT_AMOUNT });
            expect(await weth.balanceOf(user.address)).to.equal(DEPOSIT_AMOUNT);
        });

        it("Should update total supply", async function () {
            await weth.connect(user).deposit({ value: DEPOSIT_AMOUNT });
            expect(await weth.totalSupply()).to.equal(DEPOSIT_AMOUNT);
        });

        it("Should emit Deposit event", async function () {
            await expect(weth.connect(user).deposit({ value: DEPOSIT_AMOUNT }))
                .to.emit(weth, "Deposit")
                .withArgs(user.address, DEPOSIT_AMOUNT);
        });

        it("Should accept ETH via receive function", async function () {
            await user.sendTransaction({
                to: await weth.getAddress(),
                value: DEPOSIT_AMOUNT
            });
            expect(await weth.balanceOf(user.address)).to.equal(DEPOSIT_AMOUNT);
        });
    });

    describe("Withdraw", function () {
        beforeEach(async function () {
            await weth.connect(user).deposit({ value: DEPOSIT_AMOUNT });
        });

        it("Should burn WETH on withdraw", async function () {
            await weth.connect(user).withdraw(DEPOSIT_AMOUNT);
            expect(await weth.balanceOf(user.address)).to.equal(0);
        });

        it("Should return ETH to user", async function () {
            const balanceBefore = await ethers.provider.getBalance(user.address);
            const tx = await weth.connect(user).withdraw(DEPOSIT_AMOUNT);
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
            const balanceAfter = await ethers.provider.getBalance(user.address);
            expect(balanceAfter).to.equal(balanceBefore + DEPOSIT_AMOUNT - gasUsed);
        });

        it("Should emit Withdrawal event", async function () {
            await expect(weth.connect(user).withdraw(DEPOSIT_AMOUNT))
                .to.emit(weth, "Withdrawal")
                .withArgs(user.address, DEPOSIT_AMOUNT);
        });

        it("Should revert if insufficient balance", async function () {
            await expect(
                weth.connect(user).withdraw(DEPOSIT_AMOUNT + 1n)
            ).to.be.revertedWith("Insufficient balance");
        });

        it("Should allow partial withdraw", async function () {
            const withdrawAmount = ethers.parseEther("5");
            await weth.connect(user).withdraw(withdrawAmount);
            expect(await weth.balanceOf(user.address)).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
        });
    });

    describe("ERC20 Functions", function () {
        beforeEach(async function () {
            await weth.connect(user).deposit({ value: DEPOSIT_AMOUNT });
        });

        it("Should transfer WETH", async function () {
            const amount = ethers.parseEther("5");
            await weth.connect(user).transfer(owner.address, amount);
            expect(await weth.balanceOf(owner.address)).to.equal(amount);
        });

        it("Should approve and transferFrom", async function () {
            const amount = ethers.parseEther("5");
            await weth.connect(user).approve(owner.address, amount);
            await weth.connect(owner).transferFrom(user.address, owner.address, amount);
            expect(await weth.balanceOf(owner.address)).to.equal(amount);
        });
    });
});
