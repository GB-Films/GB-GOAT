'use strict';
const { BANI_PROVIDER_ID } = require('./crmBaniPost');
const isInternalBudgetEstimate = row => row?.providerId === BANI_PROVIDER_ID && row?.economicNature === 'internal_estimate';
module.exports = { isInternalBudgetEstimate };
