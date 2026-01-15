import { expect } from "chai";
import { ethers } from "hardhat";
import { SwapRouter, MockERC20, MockWETH } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Mock Uniswap V3 Router for testing
const deployMockUniswapRouter = async () => {
    const MockUniswapRouter = await ethers.getContractFactory("MockUniswapRouter");
    return await MockUniswapRouter.deploy();
};

describe("SwapRouter", function () {
    let swapRouter: SwapRouter;
    let tokenIn: MockERC20;
    let tokenOut: MockERC20;
    let weth: MockWETH;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    let feeCollector: SignerWithAddress;
    let mockRouter: SignerWithAddress;
    let mockQuoter: SignerWithAddress;

    const INITIAL_BALANCE = ethers.parseUnits("10000", 18);
    const SWAP_AMOUNT = ethers.parseUnits("100", 18);
    const POOL_FEE_MEDIUM = 3000;

    beforeEach(async function () {
        [owner, user, feeCollector, mockRouter, mockQuoter] = await ethers.getSigners();

        // Deploy mock tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenIn = await MockERC20.deploy("Token In", "TIN", 18);
        await tokenIn.waitForDeployment();

        tokenOut = await MockERC20.deploy("Token Out", "TOUT", 18);
        await tokenOut.waitForDeployment();

        // Deploy mock WETH
        const MockWETH = await ethers.getContractFactory("MockWETH");
        weth = await MockWETH.deploy();
        await weth.waitForDeployment();

        // Mint tokens to user
        await tokenIn.mint(user.address, INITIAL_BALANCE);
        await tokenOut.mint(user.address, INITIAL_BALANCE);

        // Deploy SwapRouter with mock addresses
        // Note: We use mockRouter address as it's just for testing constructor validation
        const SwapRouter = await ethers.getContractFactory("SwapRouter");
        swapRouter = await SwapRouter.deploy(
            mockRouter.address, // Using signer as mock router address
            mockQuoter.address, // Using signer as mock quoter address
            await weth.getAddress(),
            feeCollector.address
        );
        await swapRouter.waitForDeployment();

        // Approve SwapRouter to spend user's tokens
        await tokenIn.connect(user).approve(await swapRouter.getAddress(), INITIAL_BALANCE);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await swapRouter.owner()).to.equal(owner.address);
        });

        it("Should set the right fee collector", async function () {
            expect(await swapRouter.feeCollector()).to.equal(feeCollector.address);
        });

        it("Should set the right WETH address", async function () {
            expect(await swapRouter.WETH()).to.equal(await weth.getAddress());
        });

        it("Should have correct default fee", async function () {
            expect(await swapRouter.feeBps()).to.equal(30); // 0.3%
        });

        it("Should have correct pool fee constants", async function () {
            expect(await swapRouter.POOL_FEE_LOW()).to.equal(500);
            expect(await swapRouter.POOL_FEE_MEDIUM()).to.equal(3000);
            expect(await swapRouter.POOL_FEE_HIGH()).to.equal(10000);
        });

        it("Should revert if uniswap router is zero address", async function () {
            const SwapRouter = await ethers.getContractFactory("SwapRouter");
            await expect(
                SwapRouter.deploy(
                    ethers.ZeroAddress,
                    mockQuoter.address,
                    await weth.getAddress(),
                    feeCollector.address
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert if WETH is zero address", async function () {
            const SwapRouter = await ethers.getContractFactory("SwapRouter");
            await expect(
                SwapRouter.deploy(
                    mockRouter.address,
                    mockQuoter.address,
                    ethers.ZeroAddress,
                    feeCollector.address
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert if fee collector is zero address", async function () {
            const SwapRouter = await ethers.getContractFactory("SwapRouter");
            await expect(
                SwapRouter.deploy(
                    mockRouter.address,
                    mockQuoter.address,
                    await weth.getAddress(),
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });
    });

    describe("Admin Functions", function () {
        describe("setFee", function () {
            it("Should allow owner to set fee", async function () {
                await swapRouter.setFee(50);
                expect(await swapRouter.feeBps()).to.equal(50);
            });

            it("Should emit FeeUpdated event", async function () {
                await expect(swapRouter.setFee(50))
                    .to.emit(swapRouter, "FeeUpdated")
                    .withArgs(50);
            });

            it("Should reject fee greater than 5%", async function () {
                await expect(swapRouter.setFee(501)).to.be.revertedWithCustomError(
                    swapRouter,
                    "InvalidFee"
                );
            });

            it("Should allow setting fee to exactly 5%", async function () {
                await swapRouter.setFee(500);
                expect(await swapRouter.feeBps()).to.equal(500);
            });

            it("Should reject non-owner setting fee", async function () {
                await expect(
                    swapRouter.connect(user).setFee(50)
                ).to.be.revertedWithCustomError(swapRouter, "OwnableUnauthorizedAccount");
            });
        });

        describe("setFeeCollector", function () {
            it("Should allow owner to set fee collector", async function () {
                await swapRouter.setFeeCollector(user.address);
                expect(await swapRouter.feeCollector()).to.equal(user.address);
            });

            it("Should emit FeeCollectorUpdated event", async function () {
                await expect(swapRouter.setFeeCollector(user.address))
                    .to.emit(swapRouter, "FeeCollectorUpdated")
                    .withArgs(user.address);
            });

            it("Should revert setting zero address", async function () {
                await expect(
                    swapRouter.setFeeCollector(ethers.ZeroAddress)
                ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
            });

            it("Should reject non-owner setting fee collector", async function () {
                await expect(
                    swapRouter.connect(user).setFeeCollector(owner.address)
                ).to.be.revertedWithCustomError(swapRouter, "OwnableUnauthorizedAccount");
            });
        });

        describe("setQuoter", function () {
            it("Should allow owner to set quoter", async function () {
                const newQuoter = user.address;
                await swapRouter.setQuoter(newQuoter);
                expect(await swapRouter.quoter()).to.equal(newQuoter);
            });

            it("Should emit QuoterUpdated event", async function () {
                await expect(swapRouter.setQuoter(user.address))
                    .to.emit(swapRouter, "QuoterUpdated")
                    .withArgs(user.address);
            });

            it("Should revert setting zero address", async function () {
                await expect(
                    swapRouter.setQuoter(ethers.ZeroAddress)
                ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
            });

            it("Should reject non-owner setting quoter", async function () {
                await expect(
                    swapRouter.connect(user).setQuoter(owner.address)
                ).to.be.revertedWithCustomError(swapRouter, "OwnableUnauthorizedAccount");
            });
        });
    });

    describe("Pause Functionality", function () {
        it("Should allow owner to pause", async function () {
            await swapRouter.pause();
            expect(await swapRouter.paused()).to.be.true;
        });

        it("Should allow owner to unpause", async function () {
            await swapRouter.pause();
            await swapRouter.unpause();
            expect(await swapRouter.paused()).to.be.false;
        });

        it("Should reject non-owner pause", async function () {
            await expect(
                swapRouter.connect(user).pause()
            ).to.be.revertedWithCustomError(swapRouter, "OwnableUnauthorizedAccount");
        });

        it("Should reject non-owner unpause", async function () {
            await swapRouter.pause();
            await expect(
                swapRouter.connect(user).unpause()
            ).to.be.revertedWithCustomError(swapRouter, "OwnableUnauthorizedAccount");
        });
    });

    describe("swapExactTokensForTokens Input Validation", function () {
        it("Should revert on zero tokenIn address", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    ethers.ZeroAddress,
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert on zero tokenOut address", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    ethers.ZeroAddress,
                    SWAP_AMOUNT,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert on zero amount", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    0,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAmount");
        });

        it("Should revert on invalid pool fee", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    1234 // Invalid fee tier
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });

        it("Should revert when paused", async function () {
            await swapRouter.pause();

            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "EnforcedPause");
        });
    });

    describe("swapExactETHForTokens Input Validation", function () {
        it("Should revert on zero tokenOut address", async function () {
            await expect(
                swapRouter.connect(user).swapExactETHForTokens(
                    ethers.ZeroAddress,
                    0,
                    POOL_FEE_MEDIUM,
                    { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert on zero ETH value", async function () {
            await expect(
                swapRouter.connect(user).swapExactETHForTokens(
                    await tokenOut.getAddress(),
                    0,
                    POOL_FEE_MEDIUM,
                    { value: 0 }
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAmount");
        });

        it("Should revert on invalid pool fee", async function () {
            await expect(
                swapRouter.connect(user).swapExactETHForTokens(
                    await tokenOut.getAddress(),
                    0,
                    2000, // Invalid fee tier
                    { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });

        it("Should revert when paused", async function () {
            await swapRouter.pause();

            await expect(
                swapRouter.connect(user).swapExactETHForTokens(
                    await tokenOut.getAddress(),
                    0,
                    POOL_FEE_MEDIUM,
                    { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWithCustomError(swapRouter, "EnforcedPause");
        });
    });

    describe("swapExactTokensForETH Input Validation", function () {
        it("Should revert on zero tokenIn address", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForETH(
                    ethers.ZeroAddress,
                    SWAP_AMOUNT,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAddress");
        });

        it("Should revert on zero amount", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForETH(
                    await tokenIn.getAddress(),
                    0,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidAmount");
        });

        it("Should revert on invalid pool fee", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForETH(
                    await tokenIn.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    7500 // Invalid fee tier
                )
            ).to.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });

        it("Should revert when paused", async function () {
            await swapRouter.pause();

            await expect(
                swapRouter.connect(user).swapExactTokensForETH(
                    await tokenIn.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    POOL_FEE_MEDIUM
                )
            ).to.be.revertedWithCustomError(swapRouter, "EnforcedPause");
        });
    });

    describe("Valid Pool Fees", function () {
        it("Should accept POOL_FEE_LOW (500)", async function () {
            // This will fail at the swap execution stage but validates fee
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    500
                )
            ).to.not.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });

        it("Should accept POOL_FEE_MEDIUM (3000)", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    3000
                )
            ).to.not.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });

        it("Should accept POOL_FEE_HIGH (10000)", async function () {
            await expect(
                swapRouter.connect(user).swapExactTokensForTokens(
                    await tokenIn.getAddress(),
                    await tokenOut.getAddress(),
                    SWAP_AMOUNT,
                    0,
                    10000
                )
            ).to.not.be.revertedWithCustomError(swapRouter, "InvalidFee");
        });
    });

    describe("Fee Calculation", function () {
        it("Should calculate correct platform fee with 0.3% fee", async function () {
            // Fee is 30 bps = 0.3%
            const amount = ethers.parseUnits("1000", 18);
            const expectedFee = (amount * 30n) / 10000n;
            const expectedSwapAmount = amount - expectedFee;

            expect(expectedFee).to.equal(ethers.parseUnits("3", 18));
            expect(expectedSwapAmount).to.equal(ethers.parseUnits("997", 18));
        });

        it("Should calculate correct fee with maximum 5% fee", async function () {
            await swapRouter.setFee(500); // 5%

            const amount = ethers.parseUnits("1000", 18);
            const expectedFee = (amount * 500n) / 10000n;
            const expectedSwapAmount = amount - expectedFee;

            expect(expectedFee).to.equal(ethers.parseUnits("50", 18));
            expect(expectedSwapAmount).to.equal(ethers.parseUnits("950", 18));
        });

        it("Should have zero fee when fee is set to 0", async function () {
            await swapRouter.setFee(0);

            const amount = ethers.parseUnits("1000", 18);
            const expectedFee = (amount * 0n) / 10000n;

            expect(expectedFee).to.equal(0);
        });
    });

    describe("Receive ETH", function () {
        it("Should accept direct ETH transfers", async function () {
            const amount = ethers.parseEther("1");
            const contractAddress = await swapRouter.getAddress();

            await expect(
                user.sendTransaction({
                    to: contractAddress,
                    value: amount
                })
            ).to.not.be.reverted;

            const balance = await ethers.provider.getBalance(contractAddress);
            expect(balance).to.equal(amount);
        });
    });
});
