function getCurrentTimestamp() {
    return new Date().toUTCString();
}

module.exports = {
    getCurrentTimestamp
};