const LiquidatePositions = require('../index.js');
require('dotenv').config();

async function main() {
    const liquidatePosition = new LiquidatePositions(
        process.env.NETWORK_RPC,
        process.env.PLP_CONTRACT_ADDRESS,
        process.env.PLP_LIQUIDATION_CONTRACT_ADDRESS,
        process.env.PLP_SUBGRAPH_URL,
        process.env.PRICE_AGGREGATOR_CONTRACT_ADDRESS,
        process.env.PYTH_PRICE_PROVIDER_CONTRACT_ADDRESS,
        process.env.TIME_BEFORE_EXPIRATION,
        process.env.PYTHNET_PRICE_FEED_ENDPOINT
    );

    let result = await liquidatePosition.getLiquidatePositions();
    console.log(result);
}

main();