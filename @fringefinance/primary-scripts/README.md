# Get the list of liquidatable positions 📝
This is an instruction on setting up package to get the list of liquidatable positions in Primary Fringe Finance platform. Let's follow these simple steps:

## Step 1: Install 🚀
**Using NPM**
  ```
npm i primary-scripts
  ```
**Yarn**
  ```
yarn add primary-scripts
  ```

## Step 2: Setup configs ✨
Create file `.env` and set the following in your .env file or environment:
  ```
NETWORK_RPC={$NETWORK_RPC}
PLP_CONTRACT_ADDRESS={$PIT_CONTRACT_ADDRESS}
PLP_LIQUIDATION_CONTRACT_ADDRESS={$PIT_LIQUIDATION_CONTRACT_ADDRESS}
PLP_SUBGRAPH_URL={$PIT_SUBGRAPH_URL}

PRICE_AGGREGATOR_CONTRACT_ADDRESS={$PRICE_AGGREGATOR_CONTRACT_ADDRESS}
PYTH_PRICE_PROVIDER_CONTRACT_ADDRESS={$PYTH_PRICE_PROVIDER_CONTRACT_ADDRESS}
TIME_BEFORE_EXPIRATION={$TIME_BEFORE_EXPIRATION} //ex: 15
PYTHNET_PRICE_FEED_ENDPOINT={$PYTHNET_PRICE_FEED_ENDPOINT} // ex: https://hermes.pyth.network
  ```

## Step 3: Usage 🔥
  ```
// In Node.js
const LiquidatePositions = require('@fringefinance/primary-scripts');
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

(async function() {
    const result = await liquidatePosition.getLiquidatePositions();
    console.log(result);
})();
  ```