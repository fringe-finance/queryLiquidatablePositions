const LiquidatePositions = require('@fringefinance/primary-scripts');
const Web3 = require('web3');
const path = require('path');
const dotenv = require('dotenv');

// Get the directory path of the current script
const scriptDir = path.dirname(__filename);

// Construct the path to the .env file relative to the script's directory
const envFilePath = path.join(scriptDir, '.env');

// Load environment variables from the .env file
dotenv.config({ path: envFilePath });

async function normalizeUrl(baseUrl, ...segments) {
    // Ensure the base URL ends with a single slash
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '') + '/';
    // Normalize each segment to ensure it does not start or end with a slash
    const normalizedSegments = segments.map(segment => segment.replace(/^\/+|\/+$/g, ''));
    // Join the base URL with the normalized segments
    return new URL(normalizedSegments.join('/'), normalizedBaseUrl).href;
}

async function makeOutputReadable(result, chainName, minValue) {
    let countOfPositions = 0;
    let sumOfLendingTokenValue = 0; // purpose of this is to act as a hash and also to provide high level overview
    let readableResult = [];
    let promises = [];
    let liquidationContractAddress = process.env[`${chainName.toUpperCase()}_PLP_LIQUIDATION_CONTRACT_ADDRESS`];
    let plpAddress = process.env[`${chainName.toUpperCase()}_PLP_CONTRACT_ADDRESS`];
    let explorerUrl = process.env[`${chainName.toUpperCase()}_EXPLORER_URL`];

    for (let liquidatablePositionKey in result.liquidatablePositions) {
        let liquidatablePosition = Object.values(result.liquidatablePositions[liquidatablePositionKey]);

        let [borrowerAddress, collateralTokenAddress, collateralTokenValue, collateralTokenCount, lendingTokenAddress, lendingTokenOutstandingCount, lendingTokenOutstandingValue, healthFactor, minRepaymentTokenCount, maxRepaymentTokenCount, liquidatorRewardFactor, chainId] = liquidatablePosition;

        let collateralDecimalsPromise = getTokenDecimals(collateralTokenAddress, process.env[`${chainName.toUpperCase()}_NETWORK_RPC`]);
        let lendingDecimalsPromise = getTokenDecimals(lendingTokenAddress, process.env[`${chainName.toUpperCase()}_NETWORK_RPC`]);
        let collateralSymbolPromise = getTokenSymbol(collateralTokenAddress, process.env[`${chainName.toUpperCase()}_NETWORK_RPC`]);
        let lendingSymbolPromise = getTokenSymbol(lendingTokenAddress, process.env[`${chainName.toUpperCase()}_NETWORK_RPC`]);
        let fContractAddressPromise = getFLendingTokenAddress(plpAddress, lendingTokenAddress, process.env[`${chainName.toUpperCase()}_NETWORK_RPC`]);

        // Collect all promises for concurrent execution
        promises.push(
            Promise.all([collateralDecimalsPromise, lendingDecimalsPromise, collateralSymbolPromise, lendingSymbolPromise, fContractAddressPromise]).then(async values => {
                let [collateralDecimals, lendingDecimals, collateralSymbol, lendingSymbol, fContractAddress] = values;

                collateralTokenCount /= 10 ** collateralDecimals;
                lendingTokenOutstandingCount /= 10 ** lendingDecimals;
                collateralTokenValue /= 10 ** 6;
                lendingTokenOutstandingValue /= 10 ** 6;
                let collateralPriceUSD = collateralTokenValue / collateralTokenCount;
                let lendingPriceUSD = lendingTokenOutstandingValue / lendingTokenOutstandingCount;
                minRepaymentTokenCount /= 10 ** lendingDecimals;
                maxRepaymentTokenCount /= 10 ** lendingDecimals;
                let maxRepaymentValue = maxRepaymentTokenCount * lendingPriceUSD;
                let collateralValueUSD = Math.round(collateralTokenValue * 100) / 100;
                let lendingValueUSD = Math.round(lendingTokenOutstandingValue * 100) / 100;
                collateralPriceUSD = Math.round(collateralPriceUSD * 100) / 100;
                lendingPriceUSD = Math.round(lendingPriceUSD * 100) / 100;
                let maxRepaymentValueUSD = Math.round(maxRepaymentValue * 100) / 100;
                liquidatorRewardFactor = Math.round(liquidatorRewardFactor * 100) / 100;
                healthFactor = Math.round(healthFactor * 100) / 100;
                // join explorer url + "/address/" to to borrower address using url library
                let borrowerAddressUrl = await normalizeUrl(explorerUrl, "/address/", borrowerAddress);
                let liquidationContractAddressUrl = await normalizeUrl(explorerUrl, "/address/", liquidationContractAddress);
                let plpAddressUrl = await normalizeUrl(explorerUrl, "/address/", plpAddress);
                let fContractAddressUrl = await normalizeUrl(explorerUrl, "/address/", fContractAddress);
                let lendingTokenAddressUrl = await normalizeUrl(explorerUrl, "/address/", lendingTokenAddress);
                let collateralTokenAddressUrl = await normalizeUrl(explorerUrl, "/address/", collateralTokenAddress);

                let borrowerAddressList = [borrowerAddressUrl, borrowerAddress]
                let liquidationContractAddressList = [liquidationContractAddressUrl, liquidationContractAddress]
                let plpAddressList = [plpAddressUrl, plpAddress]
                let fContractAddressList = [fContractAddressUrl, fContractAddress]
                let lendingTokenAddressList = [lendingTokenAddressUrl, lendingTokenAddress]
                let collateralTokenAddressList = [collateralTokenAddressUrl, collateralTokenAddress]

                let liquidatorPnlUSD = 0;
                if (collateralValueUSD > lendingValueUSD) {
                    liquidatorPnlUSD = maxRepaymentValueUSD * (liquidatorRewardFactor - 1);
                }
                else {
                    liquidatorPnlUSD = collateralValueUSD - lendingValueUSD;
                }
                liquidatorPnlUSD = Math.round(liquidatorPnlUSD * 100) / 100;

                let evaluationData = {
                    liquidatorPnlUSD, collateralSymbol, collateralPriceUSD, lendingSymbol, lendingPriceUSD, collateralValueUSD, lendingValueUSD, liquidatorRewardFactor, healthFactor, maxRepaymentValueUSD
                };
                let executionData = { borrowerAddressList, collateralTokenAddressList, lendingTokenAddressList, minRepaymentTokenCount, maxRepaymentTokenCount, fContractAddressList, plpAddressList, liquidationContractAddressList };
                if (Math.abs(evaluationData.liquidatorPnlUSD) > Math.abs(minValue)) {
                    sumOfLendingTokenValue += lendingValueUSD
                    countOfPositions += 1;
                    readableResult.push({ evaluationData, executionData });
                }
            })
        );
    }

    // Wait for all promises to resolve
    await Promise.all(promises);
    readableResult = readableResult.sort((a, b) => {
        const absA = Math.abs(a.evaluationData.liquidatorPnlUSD);
        const absB = Math.abs(b.evaluationData.liquidatorPnlUSD);
        return absB - absA; // Sort by largest absolute value first
    });
    return readableResult, sumOfLendingTokenValue, countOfPositions;
}

async function getTokenSymbol(tokenAddress, rpcUrl) {
    // Initialize a web3 instance with the provided RPC URL
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

    // ERC-20 Token ABI with only the symbol function
    const tokenAbi = [
        {
            "constant": true,
            "inputs": [],
            "name": "symbol",
            "outputs": [{ "name": "", "type": "string" }],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        }
    ];

    // Create a contract instance for the given token address
    const tokenContract = new web3.eth.Contract(tokenAbi, tokenAddress);

    try {
        // Call the symbol function of the contract
        const symbol = await tokenContract.methods.symbol().call();
        return symbol; // Return the token symbol
    } catch (error) {
        console.error('An error occurred:', error);
        return null; // Return null in case of an error
    }
}

async function getFLendingTokenAddress(contractAddress, lendingTokenAddress, rpcUrl) {
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

    // ABI for the lendingTokenInfo function
    const contractAbi = [
        {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "name": "lendingTokenInfo",
            "outputs": [
                {
                    "internalType": "bool",
                    "name": "isListed",
                    "type": "bool"
                },
                {
                    "internalType": "bool",
                    "name": "isPaused",
                    "type": "bool"
                },
                {
                    "internalType": "contract BLendingToken",
                    "name": "bLendingToken",
                    "type": "address"
                },
                {
                    "internalType": "struct PrimaryLendingPlatformV2Core.Ratio",
                    "name": "loanToValueRatio",
                    "type": "tuple"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ];

    // Create a contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    try {
        // Call the lendingTokenInfo function
        const result = await contract.methods.lendingTokenInfo(lendingTokenAddress).call();

        // Return the blending token address
        return result.bLendingToken;
    } catch (error) {
        console.error('An error occurred:', error);
        return null; // Return null in case of an error
    }
}

// Define the function to get token decimals
async function getTokenDecimals(tokenAddress, rpcUrl) {
    // Initialize a web3 instance with the provided RPC URL
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));

    // ERC-20 Token ABI with only the decimals function
    const tokenAbi = [
        {
            "constant": true,
            "inputs": [],
            "name": "decimals",
            "outputs": [{ "name": "", "type": "uint8" }],
            "payable": false,
            "stateMutability": "view",
            "type": "function"
        }
    ];

    // Create a contract instance for the given token address
    const tokenContract = new web3.eth.Contract(tokenAbi, tokenAddress);

    try {
        // Call the decimals function of the contract
        const decimals = await tokenContract.methods.decimals().call();
        return decimals; // Return the number of decimals
    } catch (error) {
        console.error('An error occurred:', error);
        return null; // Return null in case of an error
    }
}


// Define an async function to liquidate positions for a given chain
async function liquidateForChain(chainName, minValue) {
    // Use environment variables specific to the chain
    rpcUrl = process.env[`${chainName.toUpperCase()}_NETWORK_RPC`];
    plpAddress = process.env[`${chainName.toUpperCase()}_PLP_CONTRACT_ADDRESS`];
    liquidationContractAddress = process.env[`${chainName.toUpperCase()}_PLP_LIQUIDATION_CONTRACT_ADDRESS`];
    subgraphUrl = process.env[`${chainName.toUpperCase()}_PLP_SUBGRAPH_URL`];
    priceAggregatorAddress = process.env[`${chainName.toUpperCase()}_PRICE_AGGREGATOR_CONTRACT_ADDRESS`];
    pythPriceProviderAddress = process.env[`${chainName.toUpperCase()}_PYTH_PRICE_PROVIDER_CONTRACT_ADDRESS`];
    timeBeforeExpiration = process.env[`${chainName.toUpperCase()}_TIME_BEFORE_EXPIRATION`];
    pythnetPriceFeedEndpoint = process.env[`${chainName.toUpperCase()}_PYTHNET_PRICE_FEED_ENDPOINT`];

    const liquidatePosition = new LiquidatePositions(rpcUrl, plpAddress, liquidationContractAddress, subgraphUrl, priceAggregatorAddress, pythPriceProviderAddress, timeBeforeExpiration, pythnetPriceFeedEndpoint);

    // Execute the liquidation process for the chain
    console.log(`\n\n\nChain: ${chainName}  ` + rpcUrl);
    const result = await liquidatePosition.getLiquidatePositions();
    readableResult, sumOfLendingTokenValue, countOfPositions = await makeOutputReadable(result, chainName, minValue);
    console.log(JSON.stringify(readableResult, null, 2)); // The '2' here specifies the number of spaces used for indentation
    console.log("total lending value: US$", sumOfLendingTokenValue, "positions count: ", countOfPositions);
}

async function processChains(chains, minValue) {
    for (const chain of chains) {
        await liquidateForChain(chain, minValue).catch(console.error);
    }
}

const yargs = require('yargs');

const argv = yargs
    .usage('Usage: $0 [options] [chains...]')
    .option('minValue', {
        alias: 'm',
        describe: 'Minimum value for processing chains',
        type: 'number',
        default: 0,
    })
    .help('h')
    .alias('h', 'help')
    .example('$0 --minValue 100 ZKSYNC OPTIMISM', 'Process ZKSYNC and OPTIMISM chains with a minimum value of 100')
    .example('$0 ZKSYNC OPTIMISM', 'Process ZKSYNC and OPTIMISM chains with the default minimum value')
    .demandCommand(1, 'Please specify at least one chain or use the default chains')
    .argv;

const chains = argv._;


processChains(chains, argv.minValue).catch(console.error);