require('dotenv').config();
const priceAggregatorContractABI = require('../abis/PriceAggregator.json');
const { EvmPriceServiceConnection } = require('@pythnetwork/pyth-evm-js');

class PriceAggregatorService {
    constructor(
        web3Service,
        priceAggregatorContractAddress,
        pythPriceProviderContractAddress,
        timeBeforeExpiration,
        pythnetPriceFeedEndpoint
    ) {
        this.pythPriceProviderContractAddress = pythPriceProviderContractAddress;
        this.timeBeforeExpiration = timeBeforeExpiration;
        this.pythnetPriceFeedEndpoint = pythnetPriceFeedEndpoint;
        this.priceAggregatorContract = web3Service.createContract(priceAggregatorContractABI, priceAggregatorContractAddress);
        this.connection = new EvmPriceServiceConnection(
            this.pythnetPriceFeedEndpoint
        );
    }

    async isUsingPythOracle(tokenAddress) {
        try {
            const priceProvider = await this.priceAggregatorContract.methods.tokenPriceProvider(tokenAddress).call();
            return this.pythPriceProviderContractAddress === priceProvider;
        } catch (error) {
            throw new Error(`Error when check token is using pyth oracle`);
        }
    }

    async getExpiredPriceFeeds(listToken) {
        try {
            return await this.priceAggregatorContract.methods.getExpiredPriceFeeds(
                listToken,
                this.timeBeforeExpiration
            ).call();
        } catch (error) {
            throw new Error(`Error when get expired price feeds`);
        }
    }

    async getUpdatePriceData(listTokens) {

        let updatePriceData = {
            priceIds: [],
            updateData: [],
            updateFee: 0
        }

        let listTokensUsePythOracle = [];
        for (let i = 0; i < listTokens.length; i++) {
            const isUsingPythOracle = await this.isUsingPythOracle(listTokens[i]);
            if (isUsingPythOracle) listTokensUsePythOracle.push(listTokens[i]);
        }
        if (listTokensUsePythOracle.length === 0) return updatePriceData;
        const { priceIds, updateFee } = await this.getExpiredPriceFeeds(listTokensUsePythOracle);

        if (priceIds.length === 0) return updatePriceData;

        let updateData;
        try {
            updateData = await this.connection.getPriceFeedsUpdateData(priceIds);
        } catch (error) {
            throw new Error(`Error when get price feeds update data from pythnet service`);
        }
        updatePriceData = {
            priceIds,
            updateData,
            updateFee
        }
        return updatePriceData;
    }

}

module.exports = PriceAggregatorService