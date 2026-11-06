import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentEnvironment} from '../scripts/deploy-environment.mjs';

const names={siteName:'example-site',targetName:'example-site-music'};
test('secondary deployment removes site CI name and tag while preserving authentication and CI metadata',()=>{
  const original=Object.freeze({
    WRANGLER_CI_OVERRIDE_NAME:'example-site',WRANGLER_CI_MATCH_TAG:'site-only-tag',
    CLOUDFLARE_API_TOKEN:'test-only-token',CLOUDFLARE_ACCOUNT_ID:'test-account',
    WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',PATH:'test-path'
  });
  const child=deploymentEnvironment(original,names);
  assert.equal(child.WRANGLER_CI_OVERRIDE_NAME,undefined);
  assert.equal(child.WRANGLER_CI_MATCH_TAG,undefined);
  for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','WORKERS_CI','WORKERS_CI_BRANCH','PATH'])assert.equal(child[key],original[key]);
  assert.equal(original.WRANGLER_CI_OVERRIDE_NAME,'example-site');
  assert.equal(original.WRANGLER_CI_MATCH_TAG,'site-only-tag');
  const site=deploymentEnvironment(original,{...names,targetName:names.siteName});
  assert.deepEqual(site,original);assert.notEqual(site,original);
});

test('unexpected connected CI target fails before either deployment, instead of overriding another Worker',()=>{
  const env={WRANGLER_CI_OVERRIDE_NAME:'different-site'};
  assert.throws(()=>deploymentEnvironment(env,names),/No Worker was deployed/);
  assert.throws(()=>deploymentEnvironment(env,{...names,targetName:names.siteName}),/No Worker was deployed/);
  assert.throws(()=>deploymentEnvironment({},{}),/explicit Worker names/);
});

test('local deployments and CI without a name override retain their original environment',()=>{
  assert.deepEqual(deploymentEnvironment({PATH:'local'},names),{PATH:'local'});
  const env={WRANGLER_CI_MATCH_TAG:'site-only-tag'};
  assert.deepEqual(deploymentEnvironment(env,names),{});
  assert.deepEqual(deploymentEnvironment(env,{...names,targetName:names.siteName}),env);
});
