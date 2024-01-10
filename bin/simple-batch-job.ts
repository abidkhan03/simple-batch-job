#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SimpleBatchJobStack } from '../lib/simple-batch-job-stack';
import { ACCOUNT_CONFIG } from '../lib/configuration';


const app = new cdk.App();
new SimpleBatchJobStack(app, 'SimpleBatchJobStack', {
  env: {
    account: ACCOUNT_CONFIG.Prod.ACCOUNT_ID,
    region: ACCOUNT_CONFIG.Prod.REGION,
  },
});

app.synth();