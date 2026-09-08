import * as cdk from 'aws-cdk-lib'
import { WagayaRecipeDnsStack } from '../lib/wagaya-recipe-dns-stack.js'
import { WagayaRecipeStack } from '../lib/wagaya-recipe-stack.js'

const app = new cdk.App()
const environment = app.node.tryGetContext('environment') || 'develop'
if (!['develop', 'production'].includes(environment))
  throw new Error('context environment must be develop or production')

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext('region') || 'ap-northeast-1',
}
if ((app.node.tryGetContext('target') || 'runtime') === 'dns') {
  if (environment !== 'production') throw new Error('DNS stack is production only')
  new WagayaRecipeDnsStack(app, 'WagayaRecipeBookDns-production', { env })
} else {
  new WagayaRecipeStack(app, `WagayaRecipeBook-${environment}`, { environment, env })
}
