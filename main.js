const LiquidatePositions = require('./@fringefinance/primary-scripts');
const Web3 = require('web3');
const path = require('path');
const dotenv = require('dotenv');
const yargs = require('yargs');

// Environment variables
const scriptDir = path.dirname(__filename);
const envFilePath = path.join(scriptDir, '.env');
dotenv.config({ path: envFilePath });

// Cache objects
const tokenDecimalsCache = {};
const tokenSymbolCache = {};
const tokenBLendingAddressCache = {};

// Retry and concurrency settings
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 5000;
const BATCH_SIZE = 2;
const BATCH_DELAY_MS = 1000;

// Basic retry helper
async function withRetry(callFn) {
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
        attempt += 1;
        try {
            return await callFn();
        } catch (err) {
            const msg = String(err.message || err);
            const transientError =
                msg.includes('Your app has exceeded its compute units per second capacity') ||
                msg.includes('ETIMEDOUT') ||
                msg.includes('ECONNRESET') ||
                msg.includes('Timeout') ||
                msg.includes('429');

            if (transientError) {
                console.error(`Retry #${attempt} after error: ${msg}`);
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                } else {
                    console.error('Max retries reached.');
                    throw err;
                }
            } else {
                console.error('Non-retryable error:', msg);
                throw err;
            }
        }
    }
}

// URL helper
function safeNormalizeUrl(baseUrl, ...segments) {
    if (!baseUrl) {
        return null;
    }
    const trimmedBaseUrl = baseUrl.replace(/\/+$/, '') + '/';
    const cleanedSegments = segments.map(s => s.replace(/^\/+|\/+$/g, ''));
    return new URL(cleanedSegments.join('/'), trimmedBaseUrl).href;
}

// ERC-20 calls with caching
async function getTokenDecimals(tokenAddress, rpcUrl) {
    if (!tokenAddress) {
        return null;
    }
    if (tokenDecimalsCache[tokenAddress]) {
        return tokenDecimalsCache[tokenAddress];
    }
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
    const tokenAbi = [{ constant: true, inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], type: 'function' }];
    const tokenContract = new web3.eth.Contract(tokenAbi, tokenAddress);
    try {
        const decimals = await withRetry(() => tokenContract.methods.decimals().call());
        tokenDecimalsCache[tokenAddress] = decimals;
        return decimals;
    } catch (err) {
        console.error('Error in getTokenDecimals:', err);
        return null;
    }
}

async function getTokenSymbol(tokenAddress, rpcUrl) {
    if (!tokenAddress) {
        return null;
    }
    if (tokenSymbolCache[tokenAddress]) {
        return tokenSymbolCache[tokenAddress];
    }
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
    const tokenAbi = [{ constant: true, inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], type: 'function' }];
    const tokenContract = new web3.eth.Contract(tokenAbi, tokenAddress);
    try {
        const symbol = await withRetry(() => tokenContract.methods.symbol().call());
        tokenSymbolCache[tokenAddress] = symbol;
        return symbol;
    } catch (err) {
        console.error('Error in getTokenSymbol:', err);
        return null;
    }
}

async function getFLendingTokenAddress(plpAddress, lendingTokenAddress, rpcUrl) {
    if (!plpAddress || !lendingTokenAddress) {
        return null;
    }
    const cacheKey = `${plpAddress}-${lendingTokenAddress}`;
    if (tokenBLendingAddressCache[cacheKey]) {
        return tokenBLendingAddressCache[cacheKey];
    }
    const web3 = new Web3(new Web3.providers.HttpProvider(rpcUrl));
    const contractAbi = [
        {
            inputs: [{ internalType: 'address', name: '', type: 'address' }],
            name: 'lendingTokenInfo',
            outputs: [
                { internalType: 'bool', name: 'isListed', type: 'bool' },
                { internalType: 'bool', name: 'isPaused', type: 'bool' },
                { internalType: 'contract BLendingToken', name: 'bLendingToken', type: 'address' },
                { internalType: 'struct PrimaryLendingPlatformV2Core.Ratio', name: 'loanToValueRatio', type: 'tuple' }
            ],
            stateMutability: 'view',
            type: 'function'
        }
    ];
    try {
        const contract = new web3.eth.Contract(contractAbi, plpAddress);
        const result = await withRetry(() => contract.methods.lendingTokenInfo(lendingTokenAddress).call());
        tokenBLendingAddressCache[cacheKey] = result.bLendingToken;
        return result.bLendingToken;
    } catch (err) {
        console.error('Error in getFLendingTokenAddress:', err);
        return null;
    }
}

// Single position processor
async function processPosition(positionObject, chainName, minValue) {
    const rpcUrl = process.env[`${chainName.toUpperCase()}_NETWORK_RPC`];
    const explorerUrl = process.env[`${chainName.toUpperCase()}_EXPLORER_URL`];
    const plpAddress = process.env[`${chainName.toUpperCase()}_PLP_CONTRACT_ADDRESS`];
    const liquidationContractAddress = process.env[`${chainName.toUpperCase()}_PLP_LIQUIDATION_CONTRACT_ADDRESS`];

    if (!rpcUrl) {
        return null;
    }

    const [
        borrowerAddress,
        collateralTokenAddress,
        rawCollateralValue,
        rawCollateralCount,
        lendingTokenAddress,
        rawLendingTokenCount,
        rawLendingTokenValue,
        rawHealthFactor,
        rawMinRepayment,
        rawMaxRepayment,
        rawLiquidatorReward
    ] = Object.values(positionObject);

    // Debug to show the raw values
    // console.log('DEBUG: Raw position data =>', {
    //     borrowerAddress,
    //     collateralTokenAddress,
    //     rawCollateralValue,
    //     rawCollateralCount,
    //     lendingTokenAddress,
    //     rawLendingTokenCount,
    //     rawLendingTokenValue,
    //     rawHealthFactor,
    //     rawMinRepayment,
    //     rawMaxRepayment,
    //     rawLiquidatorReward
    // });

    if (!collateralTokenAddress || !lendingTokenAddress) {
        return null;
    }

    const collateralDecimals = await getTokenDecimals(collateralTokenAddress, rpcUrl);
    const lendingDecimals = await getTokenDecimals(lendingTokenAddress, rpcUrl);
    // console.log('DEBUG: Decimals =>', { collateralDecimals, lendingDecimals });

    if (!collateralDecimals || !lendingDecimals) {
        return null;
    }

    const collateralSymbol = await getTokenSymbol(collateralTokenAddress, rpcUrl);
    const lendingSymbol = await getTokenSymbol(lendingTokenAddress, rpcUrl);
    const fContractAddress = await getFLendingTokenAddress(plpAddress, lendingTokenAddress, rpcUrl);

    // // Debug to show collateral/lending counts in token units
    // console.log('DEBUG: Token counts =>', {
    //     rawCollateralCount,
    //     rawLendingTokenCount,
    //     collateralDecimals,
    //     lendingDecimals
    // });

    const collateralCount = rawCollateralCount / 10 ** collateralDecimals;
    const lendingCount = rawLendingTokenCount / 10 ** lendingDecimals;

    // Show the difference between dividing by 1e6 vs. dividing by (1e(6 + decimals))
    // console.log('DEBUG: Compare dividing rawCollateralValue =>', {
    //     dividingBy1e10: rawCollateralValue / 10 ** 10,
    //     dividingBy1e6PlusDecimals: rawCollateralValue / 10 ** (6 + collateralDecimals)
    // });
    // console.log('DEBUG: Compare dividing rawLendingTokenValue =>', {
    //     dividingBy1e10: rawLendingTokenValue / 10 ** 10,
    //     dividingBy1e6PlusDecimals: rawLendingTokenValue / 10 ** (6 + lendingDecimals)
    // });

    // Existing code
    const collateralValueUSD = Math.round((rawCollateralValue / 10 ** 10) * 100) / 100;
    const lendingValueUSD = Math.round((rawLendingTokenValue / 10 ** 10) * 100) / 100;
    // console.log('DEBUG: Computed collateralValueUSD, lendingValueUSD =>', {
    //     collateralValueUSD,
    //     lendingValueUSD
    // });

    // Derived prices
    const collateralPriceUSD = Math.round(((collateralValueUSD / collateralCount) || 0) * 100) / 100;
    const lendingPriceUSD = Math.round(((lendingValueUSD / lendingCount) || 0) * 100) / 100;

    // console.log('DEBUG: Derived collateralPriceUSD, lendingPriceUSD =>', {
    //     collateralPriceUSD,
    //     lendingPriceUSD
    // });

    const minRepaymentTokenCount = rawMinRepayment / 10 ** lendingDecimals;
    const maxRepaymentTokenCount = rawMaxRepayment / 10 ** lendingDecimals;
    const liquidatorRewardFactor = Math.round(rawLiquidatorReward * 100) / 100;
    const healthFactor = Math.round(rawHealthFactor * 100) / 100;

    const maxRepaymentValueUSD = Math.round(maxRepaymentTokenCount * lendingPriceUSD * 100) / 100;

    let liquidatorPnlUSD;
    if (collateralValueUSD > lendingValueUSD) {
        liquidatorPnlUSD = maxRepaymentValueUSD * (liquidatorRewardFactor - 1);
    } else {
        liquidatorPnlUSD = collateralValueUSD - lendingValueUSD;
    }
    liquidatorPnlUSD = Math.round(liquidatorPnlUSD * 100) / 100;

    // console.log('DEBUG: Computed liquidation stats =>', {
    //     maxRepaymentValueUSD,
    //     liquidatorPnlUSD
    // });

    if (Math.abs(liquidatorPnlUSD) <= Math.abs(minValue)) {
        return null;
    }

    const explorerBorrowerAddr = safeNormalizeUrl(explorerUrl, '/address/', borrowerAddress);
    const explorerLiquidationAddr = safeNormalizeUrl(explorerUrl, '/address/', liquidationContractAddress);
    const explorerPlpAddr = safeNormalizeUrl(explorerUrl, '/address/', plpAddress);
    const explorerFContractAddr = safeNormalizeUrl(explorerUrl, '/address/', fContractAddress);
    const explorerLendingTokenAddr = safeNormalizeUrl(explorerUrl, '/address/', lendingTokenAddress);
    const explorerCollateralTokenAddr = safeNormalizeUrl(explorerUrl, '/address/', collateralTokenAddress);

    return {
        evaluationData: {
            liquidatorPnlUSD,
            collateralSymbol,
            collateralPriceUSD,
            lendingSymbol,
            lendingPriceUSD,
            collateralValueUSD,
            lendingValueUSD,
            liquidatorRewardFactor,
            healthFactor,
            maxRepaymentValueUSD
        },
        executionData: {
            borrowerAddressList: [explorerBorrowerAddr || '', borrowerAddress],
            collateralTokenAddressList: [explorerCollateralTokenAddr || '', collateralTokenAddress],
            lendingTokenAddressList: [explorerLendingTokenAddr || '', lendingTokenAddress],
            minRepaymentTokenCount,
            maxRepaymentTokenCount,
            fContractAddressList: [explorerFContractAddr || '', fContractAddress],
            plpAddressList: [explorerPlpAddr || '', plpAddress],
            liquidationContractAddressList: [explorerLiquidationAddr || '', liquidationContractAddress]
        }
    };
}

async function makeOutputReadable(fullResult, chainName, minValue) {
    if (!fullResult || !fullResult.liquidatablePositions) {
        return [[], 0, 0, 0, 0];
    }

    let readablePositions = [];
    let totalLendingValue = 0;
    let totalCount = 0;
    let totalLosses = 0;
    let totalProfits = 0;

    const positions = Object.values(fullResult.liquidatablePositions);
    for (let i = 0; i < positions.length; i += BATCH_SIZE) {
        const batch = positions.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(pos => processPosition(pos, chainName, minValue)));
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));

        for (const item of results) {
            if (!item) {
                continue;
            }
            const { evaluationData, executionData } = item;
            totalLendingValue += evaluationData.lendingValueUSD;
            totalCount += 1;
            totalLosses += Math.min(0, evaluationData.liquidatorPnlUSD);
            totalProfits += Math.max(0, evaluationData.liquidatorPnlUSD);
            readablePositions.push({ evaluationData, executionData });
        }
    }

    readablePositions.sort((a, b) => {
        const absA = Math.abs(a.evaluationData.liquidatorPnlUSD);
        const absB = Math.abs(b.evaluationData.liquidatorPnlUSD);
        return absB - absA;
    });

    return [readablePositions, totalLendingValue, totalCount, totalLosses, totalProfits];
}

async function liquidateForChain(chainName, minValue) {
    const rpcUrl = process.env[`${chainName.toUpperCase()}_NETWORK_RPC`];
    const plpAddress = process.env[`${chainName.toUpperCase()}_PLP_CONTRACT_ADDRESS`];
    const liquidationContractAddress = process.env[`${chainName.toUpperCase()}_PLP_LIQUIDATION_CONTRACT_ADDRESS`];
    const subgraphUrl = process.env[`${chainName.toUpperCase()}_PLP_SUBGRAPH_URL`];
    const priceAggregatorAddress = process.env[`${chainName.toUpperCase()}_PRICE_AGGREGATOR_CONTRACT_ADDRESS`];
    const pythPriceProviderAddress = process.env[`${chainName.toUpperCase()}_PYTH_PRICE_PROVIDER_CONTRACT_ADDRESS`];
    const timeBeforeExpiration = process.env[`${chainName.toUpperCase()}_TIME_BEFORE_EXPIRATION`];
    const pythnetPriceFeedEndpoint = process.env[`${chainName.toUpperCase()}_PYTHNET_PRICE_FEED_ENDPOINT`];

    console.log(
        'Rpc url:', rpcUrl,
        'plp address:', plpAddress,
        'liquidation contract address:', liquidationContractAddress,
        'subgraph url:', subgraphUrl,
        'price aggregator address:', priceAggregatorAddress,
        'pyth price provider address:', pythPriceProviderAddress,
        'time before expiration:', timeBeforeExpiration,
        'pythnet price feed endpoint:', pythnetPriceFeedEndpoint
    );

    const liquidatePosition = new LiquidatePositions(
        rpcUrl,
        plpAddress,
        liquidationContractAddress,
        subgraphUrl,
        priceAggregatorAddress,
        pythPriceProviderAddress,
        timeBeforeExpiration,
        pythnetPriceFeedEndpoint
    );

    let rawResults;
    try {
        rawResults = await withRetry(() => liquidatePosition.getLiquidatePositions());
    } catch (err) {
        console.error('Failed all retries for getLiquidatePositions:', err);
        return [0, 0, 0, 0];
    }

    const [positionsReadable, sumValue, count, losses, profits] =
        await makeOutputReadable(rawResults, chainName, minValue);

    console.log(`\nChain: ${chainName}  ${rpcUrl}`);
    console.log(JSON.stringify(positionsReadable, null, 2));
    return [sumValue, count, losses, profits];
}

async function processChains(chains, minValue) {
    const promises = chains.map(chain =>
        liquidateForChain(chain, minValue).catch(err => {
            console.error(`Error processing chain ${chain}:`, err);
            return [0, 0, 0, 0];
        })
    );
    const allResults = await Promise.all(promises);

    const sumOfValues = allResults.reduce((acc, r) => acc + (r[0] || 0), 0);
    const countOfPositions = allResults.reduce((acc, r) => acc + (r[1] || 0), 0);
    const totalLosses = allResults.reduce((acc, r) => acc + (r[2] || 0), 0);
    const totalProfits = allResults.reduce((acc, r) => acc + (r[3] || 0), 0);

    console.log(
        '\nTotal borrowed value: US$',
        Math.round(sumOfValues),
        '\nPosition count:',
        countOfPositions,
        '\nTotal unrealized liquidator losses: US$',
        totalLosses,
        '\nTotal unrealized liquidator profits: US$',
        totalProfits
    );
}

const argv = yargs
    .usage('Usage: $0 [options] [chains...]')
    .option('minValue', {
        alias: 'm',
        describe: 'Minimum value for processing chains',
        type: 'number',
        default: 0
    })
    .help('h')
    .alias('h', 'help')
    .example('$0 --minValue 100 ZKSYNC OPTIMISM', 'Process ZKSYNC and OPTIMISM with a minimum of 100')
    .example('$0 ZKSYNC OPTIMISM', 'Process ZKSYNC and OPTIMISM with the default minimum')
    .demandCommand(1, 'Specify at least one chain.')
    .argv;

processChains(argv._, argv.minValue).catch(console.error);