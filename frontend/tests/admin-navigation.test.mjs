import {test} from 'node:test';import assert from 'node:assert/strict';
import {readLocation,pageUrl} from '../src/lib/navigation.js';
import {appDataIndices} from '../src/lib/pageData.js';
import {adminTime,activationLabel} from '../src/lib/adminPresentation.js';
test('dedicated admin routes round-trip without ordinary monitoring data requests',()=>{for(const page of ['Admin','Admin Login']){assert.equal(readLocation({pathname:pageUrl(page)}).page,page);assert.deepEqual(appDataIndices(page),[]);}});
test('audit timestamps explicitly interpret database UTC and render KST',()=>{const value=adminTime('2026-11-09 00:30:00');assert.match(value,/09:30/);assert.match(value,/KST/);assert.equal(adminTime(null),'Not recorded');});
test('pending verification cannot be labeled active and disabled accounts remain disabled',()=>{assert.equal(activationLabel({account_status:'ACTIVE',email_verified_at:null}),'Pending activation');assert.equal(activationLabel({account_status:'PENDING',email_verified_at:'2026-11-09',must_change_password:1}),'Pending activation');assert.equal(activationLabel({account_status:'DISABLED',email_verified_at:'2026-11-09'}),'Disabled');assert.equal(activationLabel({account_status:'ACTIVE',email_verified_at:'2026-11-09'}),'Active');});
