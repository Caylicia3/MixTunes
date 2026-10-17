'use strict';

function normaliseTrackText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function trackMetadataIdentity(track) {
  const title = normaliseTrackText(track?.title);
  const artist = normaliseTrackText(track?.artist);
  // Missing metadata must not make unrelated tracks appear to be duplicates.
  if (!title || !artist) return null;
  // A tuple keeps punctuation in either field from creating an ambiguous key.
  return JSON.stringify([title, artist]);
}

module.exports = { normaliseTrackText, trackMetadataIdentity };
