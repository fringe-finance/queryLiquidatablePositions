const Web3Service = require("./web3Service/index");
const SubgraphService = require('./subGraphService');
const PlpService = require('./plpService');
const LiquidationService = require('./liquidationService');
const { getCurrentTimestamp } = require('./helpers');
const PriceAggregatorService = require("./priceAggregatorService");

class LiquidatePositions {
    constructor(
        rpcEndpoint,
        plpContractAddress,
        liquidationContractAddress,
        subgraphURL,
        priceAggregatorContractAddress,
        pythPriceProviderContractAddress,
        timeBeforeExpiration,
        pythnetPriceFeedEndpoint
    ) {
        this.rpcEndpoint = rpcEndpoint;
        this.plpContractAddress = plpContractAddress;
        this.liquidationContractAddress = liquidationContractAddress;
        this.subgraphURL = subgraphURL;
        this.web3Service = new Web3Service(this.rpcEndpoint);
        this.subgraphService = new SubgraphService(this.subgraphURL);
        this.plpService = new PlpService(this.web3Service, this.plpContractAddress);
        this.liquidationService = new LiquidationService(this.web3Service, this.liquidationContractAddress);
        this.priceAggregatorService = new PriceAggregatorService(
            this.web3Service,
            priceAggregatorContractAddress,
            pythPriceProviderContractAddress,
            timeBeforeExpiration,
            pythnetPriceFeedEndpoint
        );
    }

    async getLiquidatePositions() {
        try {
            const listBorrowers = await this.subgraphService.getBorrowersList();
            const timestamp = getCurrentTimestamp();
            let result = {
                timestamp: timestamp,
                borrowers: listBorrowers,
                liquidatablePositions: []
            };
            const chainId = await this.web3Service.getChainID();
            for (let i = 0; i < listBorrowers.length; i++) {
                let borrowerAddress = listBorrowers[i]?.address;
                let collateralTokenAddress = listBorrowers[i]?.prjTokenAddress;
                let lendingTokenAddress = listBorrowers[i]?.lendingTokenAddress;

                let updatePriceData = await this.priceAggregatorService.getUpdatePriceData(
                    [collateralTokenAddress, lendingTokenAddress]
                );

                let priceIds = updatePriceData.priceIds;
                let updateData = updatePriceData.updateData;
                let updateFee = updatePriceData.updateFee;

                let healthFactor = await this.plpService.getCurrentHealthFactor(
                    borrowerAddress,
                    collateralTokenAddress,
                    lendingTokenAddress,
                    priceIds,
                    updateData,
                    updateFee
                );

                // state position could be liquidated: health factor < 1
                if (healthFactor > 0 && healthFactor < 1) {
                    let collateralTokenCount = listBorrowers[i]?.depositedAmount;
                    let collateralTokenValue = await this.plpService.getUsdOraclePrice(
                        collateralTokenAddress,
                        collateralTokenCount,
                        priceIds,
                        updateData,
                        updateFee
                    );
                    let lendingTokenOutstandingCount = await this.plpService.getOutstandingAmount(
                        borrowerAddress,
                        collateralTokenAddress,
                        lendingTokenAddress,
                        priceIds,
                        updateData,
                        updateFee
                    );
                    let lendingTokenOutstandingValue = await this.plpService.getUsdOraclePrice(
                        lendingTokenAddress,
                        lendingTokenOutstandingCount,
                        priceIds,
                        updateData,
                        updateFee
                    );
                    let { maxRepaymentTokenCount, minRepaymentTokenCount } = await this.liquidationService.getLiquidationAmount(
                        borrowerAddress,
                        collateralTokenAddress,
                        lendingTokenAddress,
                        priceIds,
                        updateData,
                        updateFee
                    );
                    let liquidatorRewardFactor = await this.liquidationService.getLiquidatorRewardFactor(
                        borrowerAddress,
                        collateralTokenAddress,
                        lendingTokenAddress,
                        priceIds,
                        updateData,
                        updateFee
                    );
                    result.liquidatablePositions.push({ borrowerAddress, collateralTokenAddress, collateralTokenValue, collateralTokenCount, lendingTokenAddress, lendingTokenOutstandingCount, lendingTokenOutstandingValue, healthFactor, minRepaymentTokenCount, maxRepaymentTokenCount, liquidatorRewardFactor, chainId });
                }
            }
            return result;
        } catch (err) {
            console.log(err);
        }
    }
}

module.exports = LiquidatePositions;