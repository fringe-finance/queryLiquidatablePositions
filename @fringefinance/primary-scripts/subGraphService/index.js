const axios = require('axios');
require('dotenv').config();

class SubGraphService {
    constructor(subgraphURL) {
        this.subgraphURL = subgraphURL;
    }

    async getBorrowersList() {
        try {
            const result = await axios.post(
                this.subgraphURL,
                {
                    query: `
                    {
                        borrowers(first: 1000) {
                            address
                            prjTokenAddress
                            lendingTokenAddress
                            depositedAmount
                          }
                       }
                    `
                }
            );
            return result?.data?.data?.borrowers;
        } catch (err) {
            console.log(err);
        }
    }
}

module.exports = SubGraphService