const {test}=require('node:test'),assert=require('node:assert/strict');const {conversationFallback}=require('../assistant-fallback');
test('unavailability questions explain recovery rather than repeating a greeting',()=>{const response=conversationFallback('why unavailable?');assert.match(response,/not responding/);assert.match(response,/restart/);assert.doesNotMatch(response,/Hi!|Hello!/);});
test('greeting fallback discloses limited conversation and never invents conditions',()=>{assert.match(conversationFallback('hello'),/temporarily limited/);});
