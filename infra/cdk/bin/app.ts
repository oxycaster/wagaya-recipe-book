import * as cdk from 'aws-cdk-lib'
import { WagayaRecipeStack } from '../lib/wagaya-recipe-stack.js'

const app = new cdk.App()
const environment = app.node.tryGetContext('environment') || 'develop'
if (!['develop', 'production'].includes(environment))
  throw new Error('context environment must be develop or production')

new WagayaRecipeStack(app, `WagayaRecipeBook-${environment}`, {
  environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: app.node.tryGetContext('region') || 'ap-northeast-1',
  },
})
