import { expect } from "chai";
import { ethers } from "hardhat";
import { MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MockERC20", function () {
    let token: MockERC20;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    const TOKEN_NAME = "Mock Token";
    const TOKEN_SYMBOL = "MOCK";
    const DECIMALS = 18;
    const MINT_AMOUNT = ethers.parseUnits("1000", DECIMALS);

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy(TOKEN_NAME, TOKEN_SYMBOL, DECIMALS);
        await token.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set correct name", async function () {
            expect(await token.name()).to.equal(TOKEN_NAME);
        });

        it("Should set correct symbol", async function () {
            expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
        });

        it("Should set correct decimals", async function () {
            expect(await token.decimals()).to.equal(DECIMALS);
        });

        it("Should have zero initial supply", async function () {
            expect(await token.totalSupply()).to.equal(0);
        });
    });

    describe("Minting", function () {
        it("Should mint tokens to address", async function () {
            await token.mint(user1.address, MINT_AMOUNT);
            expect(await token.balanceOf(user1.address)).to.equal(MINT_AMOUNT);
        });

        it("Should update total supply", async function () {
            await token.mint(user1.address, MINT_AMOUNT);
            expect(await token.totalSupply()).to.equal(MINT_AMOUNT);
        });

        it("Should emit Transfer event", async function () {
            await expect(token.mint(user1.address, MINT_AMOUNT))
                .to.emit(token, "Transfer")
                .withArgs(ethers.ZeroAddress, user1.address, MINT_AMOUNT);
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await token.mint(user1.address, MINT_AMOUNT);
        });

        it("Should burn tokens from address", async function () {
            const burnAmount = ethers.parseUnits("500", DECIMALS);
            await token.burn(user1.address, burnAmount);
            expect(await token.balanceOf(user1.address)).to.equal(MINT_AMOUNT - burnAmount);
        });

        it("Should update total supply after burn", async function () {
            await token.burn(user1.address, MINT_AMOUNT);
            expect(await token.totalSupply()).to.equal(0);
        });

        it("Should revert if burning more than balance", async function () {
            await expect(token.burn(user1.address, MINT_AMOUNT + 1n)).to.be.reverted;
        });
    });

    describe("ERC20 Functions", function () {
        beforeEach(async function () {
            await token.mint(user1.address, MINT_AMOUNT);
        });

        it("Should transfer tokens", async function () {
            const amount = ethers.parseUnits("100", DECIMALS);
            await token.connect(user1).transfer(user2.address, amount);
            expect(await token.balanceOf(user2.address)).to.equal(amount);
        });

        it("Should approve and transferFrom", async function () {
            const amount = ethers.parseUnits("100", DECIMALS);
            await token.connect(user1).approve(user2.address, amount);
            await token.connect(user2).transferFrom(user1.address, user2.address, amount);
            expect(await token.balanceOf(user2.address)).to.equal(amount);
        });
    });
});
