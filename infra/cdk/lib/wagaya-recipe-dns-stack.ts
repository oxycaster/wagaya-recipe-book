import * as cdk from 'aws-cdk-lib'
import { aws_iam as iam, aws_route53 as route53 } from 'aws-cdk-lib'
import { Construct } from 'constructs'

export class WagayaRecipeDnsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)
    const account = cdk.Stack.of(this).account
    if (cdk.Token.isUnresolved(account)) throw new Error('AWS account is required for this stack')
    const repository = this.node.tryGetContext('githubRepository') || 'oxycaster/wagaya-recipe-book'
    const hostedZoneId = this.node.tryGetContext('parentHostedZoneId')
    const apiStaticIp = this.node.tryGetContext('apiStaticIp')
    if (!hostedZoneId) throw new Error('parentHostedZoneId context is required')
    if (!apiStaticIp || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(apiStaticIp))
      throw new Error('apiStaticIp context must be an IPv4 address')

    const oidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidcProvider',
      `arn:${this.partition}:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
    )
    const deployRole = new iam.Role(this, 'GitHubDnsDeployRole', {
      roleName: 'wagaya-recipe-book-production-github-dns-deploy',
      assumedBy: new iam.WebIdentityPrincipal(oidc.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${repository}:environment:production` },
      }),
      description: 'GitHub Actions role for the parent Route 53 DNS stack.',
    })
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudformation:CreateChangeSet', 'cloudformation:CreateStack', 'cloudformation:DeleteChangeSet',
        'cloudformation:DeleteStack', 'cloudformation:Describe*', 'cloudformation:ExecuteChangeSet',
        'cloudformation:GetTemplate', 'cloudformation:UpdateStack',
      ],
      resources: ['*'],
    }))
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:${this.partition}:iam::${account}:role/cdk-hnb659fds-*-role-${account}-${this.region}`],
    }))

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'ParentHostedZone', {
      hostedZoneId,
      zoneName: 'oxycaster.com',
    })
    new route53.ARecord(this, 'ApiRecord', {
      zone,
      recordName: 'api.wagaya',
      target: route53.RecordTarget.fromIpAddresses(apiStaticIp),
      ttl: cdk.Duration.seconds(300),
    })
    new cdk.CfnOutput(this, 'GitHubDnsDeployRoleArn', { value: deployRole.roleArn })
    new cdk.CfnOutput(this, 'ApiRecordName', { value: 'api.wagaya.oxycaster.com' })
  }
}
