'use strict';

const QUALITY_OPTIONS = Object.freeze({
  qq: Object.freeze(['auto', 'high', 'lossless', 'standard']),
  netease: Object.freeze(['auto', 'high', 'lossless', 'standard']),
  bilibili: Object.freeze(['auto', 'standard']),
});

function isQualitySupported(platform, value) {
  return Boolean(QUALITY_OPTIONS[platform]?.includes(value));
}

function normaliseQualitySettings(data) {
  const result = {};
  for (const platform of Object.keys(QUALITY_OPTIONS)) {
    result[platform] = isQualitySupported(platform, data?.[platform]) ? data[platform] : 'auto';
  }
  return result;
}

module.exports = { normaliseQualitySettings, isQualitySupported };
