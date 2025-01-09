require('dotenv').config();
const plpContractABI = require('../abis/PrimaryLendingPlatform.json');
const Web3 = require('web3');
const BN = Web3.utils.BN;

class PlpService {
    constructor(web3Service, plpContractAddress) {
        this.plpContract = web3Service.createContract(plpContractABI, plpContractAddress);
    }

    async getOutstandingAmount(
        borrower,
        projectTokenAddress,
        lendingTokenAddress,
        priceIds,
        updateData,
        updateFee
    ) {
        const { accrual, loanBody } = await this.plpContract.methods.getPositionWithUpdatePrices(
            borrower,
            projectTokenAddress,
            lendingTokenAddress,
            priceIds,
            updateData
        ).call({ value: updateFee });
        return (new BN(accrual).add(new BN(loanBody))).toString();
    }

    async getUsdOraclePrice(
        tokenAddress,
        amount,
        priceIds,
        updateData,
        updateFee
    ) {
        return await this.plpContract.methods.getTokenEvaluationWithUpdatePrices(
            tokenAddress,
            amount,
            priceIds,
            updateData
        ).call({value: updateFee});
    }

    async getPriceOracle() {
        return await this.plpContract.methods.priceOracle().call();
    }

    async getCurrentHealthFactor(
        account,
        projectToken,
        lendingToken,
        priceIds,
        updateData,
        updateFee
    ) {
        const { healthFactorNumerator, healthFactorDenominator } = await this.plpContract.methods.getPositionWithUpdatePrices(
            account,
            projectToken,
            lendingToken,
            priceIds,
            updateData
        ).call({ value: updateFee });
        return Math.round(Number((new BN(healthFactorNumerator).mul(new BN(1000000)).div(new BN(healthFactorDenominator))).toString())) / 1000000;
    }
}

module.exports = PlpService