'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {normaliseTrackText,trackMetadataIdentity}=require('../src/track-identity.cjs');

test('metadata comparison normalises Unicode compatibility, case and whitespace',()=>{
  assert.equal(normaliseTrackText('  ＳＯＮＧ\u3000\t Name\n '),'song name');
  assert.equal(trackMetadataIdentity({title:' Ｃａｆｅ\u0301 ',artist:'\t ARTIST\u00a0Name '}),
    trackMetadataIdentity({title:'café',artist:'artist name'}));
});
test('metadata identity requires both title and artist',()=>{
  for(const value of [undefined,null,'','  \t\n ',{},42]){
    assert.equal(trackMetadataIdentity({title:value,artist:'Singer'}),null);
    assert.equal(trackMetadataIdentity({title:'Song',artist:value}),null);
  }
  assert.equal(trackMetadataIdentity(null),null);
});
test('version suffixes and distinct artist credits remain distinct',()=>{
  const original=trackMetadataIdentity({title:'Song',artist:'Alice & Bob'});
  for(const title of ['Song (Live)','Song (Remix)','Song - 现场版']){
    assert.notEqual(trackMetadataIdentity({title,artist:'Alice & Bob'}),original);
  }
  for(const artist of ['Alice','Bob & Alice','Alice feat. Bob','Alice / Bob']){
    assert.notEqual(trackMetadataIdentity({title:'Song',artist}),original);
  }
});
test('identity has no collisions from punctuation separating title and artist',()=>{
  assert.notEqual(trackMetadataIdentity({title:'a|b',artist:'c'}),trackMetadataIdentity({title:'a',artist:'b|c'}));
});
