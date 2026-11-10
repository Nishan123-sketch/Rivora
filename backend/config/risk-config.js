'use strict';
// Uncalibrated project estimate: these parameters are versioned for backtesting.
module.exports = Object.freeze({version:'station-history-v1', freshnessHours:3,
  historyDays:365, minCoverage:0.8, cacheMs:60000, intervalMs:600000,
  weights:{percentile:0.5,rise:0.25,rain:0.25},
  cutoffs:{moderate:50,high:75,severe:90},
  riseScaleMPerHour:0.5, rainScaleMm:{three:60,six:110,forecast:60},
  alert:{consecutive:2,cooldownMs:21600000,clearMs:10800000}});
