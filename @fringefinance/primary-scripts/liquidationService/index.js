require('dotenv').config();
const liquidationContractABI = require('../abis/PrimaryLendingPlatformLiquidation.json');
const Web3 = require('web3');
const BN = Web3.utils.BN;

class LiquidationService {
    constructor(web3Service, liquidationContractAddress) {
        this.liquidationContract = web3Service.createContract(liquidationContractABI, liquidationContractAddress);
    }

    async getCurrentHealthFactor(
        borrower,
        projectTokenAddress,
        lendingTokenAddress,
        priceIds,
        updateData,
        updateFee
    ) {
        const healthFactor = await this.liquidationContract.methods.getCurrentHealthFactor(
            borrower,
            projectTokenAddress,
            lendingTokenAddress,
        ).call();
        return Math.round(Number((new BN(healthFactor?.healthFactorNumerator).mul(new BN(1000000)).div(new BN(healthFactor?.healthFactorDenominator))).toString())) / 1000000;
    }

    async getLiquidatorRewardFactor(
        borrower,
        projectTokenAddress,
        lendingTokenAddress,
        priceIds,
        updateData,
        updateFee
    ) {
        const lrf = await this.liquidationContract.methods.liquidatorRewardFactorWithUpdatePrices(
            borrower,
            projectTokenAddress,
            lendingTokenAddress,
            priceIds,
            updateData
        ).call({ value: updateFee });
        return Math.round(Number((new BN(lrf?.lrfNumerator).mul(new BN(1000000)).div(new BN(lrf?.lrfDenominator))).toString())) / 1000000;
    }

    async getLiquidationAmount(
        borrower,
        projectTokenAddress,
        lendingTokenAddress,
        priceIds,
        updateData,
        updateFee
    ) {
        const result = await this.liquidationContract.methods.getLiquidationAmountWithUpdatePrices(
            borrower,
            projectTokenAddress,
            lendingTokenAddress,
            priceIds,
            updateData
        ).call({value: updateFee});
        return { maxRepaymentTokenCount: result?.maxLA, minRepaymentTokenCount: result?.minLA };
    }
}

module.exports = LiquidationService