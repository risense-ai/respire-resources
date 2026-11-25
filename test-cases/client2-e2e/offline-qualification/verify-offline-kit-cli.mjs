import {frozenBrowserSHA256,verifyOfflineKit} from './offline-kit-verify.mjs';
const [, , stage, fixture, product, buildRun, manifestDigest] = process.argv;
const verified = await verifyOfflineKit(stage,{fixture,product,buildRun,manifestDigest,browserDigest:frozenBrowserSHA256});
console.log('PASS frozen offline kit and '+verified.files+' manifest-listed files');
