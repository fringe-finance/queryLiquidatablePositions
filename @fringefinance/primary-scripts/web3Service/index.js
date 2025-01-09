require('dotenv').config();
const Web3 = require('web3');

class Web3Service {
    constructor(rpcEndpoint) {
        this.web3 = new Web3(rpcEndpoint);
    }

    async getChainID() {
        return await this.web3.eth.getChainId();
    }

    createContract(abi, address) {
        return new this.web3.eth.Contract(abi, address);
    }
}

module.exports = Web3Service