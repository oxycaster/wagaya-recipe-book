import * as cdk from 'aws-cdk-lib'
import { aws_iam as iam, aws_lightsail as lightsail, aws_s3 as s3, aws_secretsmanager as secretsmanager } from 'aws-cdk-lib'
import { Construct } from 'constructs'

export interface WagayaRecipeStackProps extends cdk.StackProps {
  environment: 'develop' | 'production'
}

export class WagayaRecipeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WagayaRecipeStackProps) {
    super(scope, id, props)
    const account = cdk.Stack.of(this).account
    if (cdk.Token.isUnresolved(account)) throw new Error('AWS account is required for this stack')

    const isProduction = props.environment === 'production'
    const name = `wagaya-recipe-book-${props.environment}`
    const archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
      bucketName: `${props.environment}-wagaya-recipe-book-archives-${account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      autoDeleteObjects: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const runtimeUser = new iam.User(this, 'RuntimeS3User', {
      userName: `${name}-runtime-s3`,
    })
    runtimeUser.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [archiveBucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['users/*'] } },
    }))
    runtimeUser.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [archiveBucket.arnForObjects('users/*')],
    }))
    const runtimeAccessKey = new iam.CfnAccessKey(this, 'RuntimeS3AccessKey', {
      userName: runtimeUser.userName,
      status: 'Active',
    })
    runtimeAccessKey.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)

    const runtimeCredentials = new secretsmanager.CfnSecret(this, 'RuntimeCredentials', {
      name: `${name}/runtime-aws`,
      description: 'CDK-managed least-privilege S3 credentials for the recipe API runtime.',
      secretString: cdk.Fn.join('', [
        '{"AWS_ACCESS_KEY_ID":"', runtimeAccessKey.ref,
        '","AWS_SECRET_ACCESS_KEY":"', runtimeAccessKey.attrSecretAccessKey,
        '","AWS_REGION":"', this.region,
        '","S3_BUCKET":"', archiveBucket.bucketName, '"}',
      ]),
    })
    runtimeCredentials.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)
    const applicationSettings = new secretsmanager.CfnSecret(this, 'ApplicationSettings', {
      name: `${name}/application-settings`,
      description: 'Operator-managed JSON settings for the recipe API. Do not store AWS credentials here.',
      secretString: '{}',
    })
    applicationSettings.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)

    const oidc = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })
    const repository = this.node.tryGetContext('githubRepository') || 'oxycaster/wagaya-recipe-book'
    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      roleName: `${name}-github-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(oidc.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: { 'token.actions.githubusercontent.com:sub': `repo:${repository}:environment:${props.environment}` },
      }),
      description: 'GitHub Actions deployment role. Restrict its policy before the first production deployment.',
    })
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudformation:CreateChangeSet', 'cloudformation:CreateStack', 'cloudformation:DeleteChangeSet',
        'cloudformation:DeleteStack', 'cloudformation:Describe*', 'cloudformation:ExecuteChangeSet',
        'cloudformation:GetTemplate', 'cloudformation:UpdateStack',
        'lightsail:GetInstanceAccessDetails', 'lightsail:GetInstanceState',
        'lightsail:OpenInstancePublicPorts', 'lightsail:CloseInstancePublicPorts',
        'secretsmanager:GetSecretValue',
      ],
      resources: ['*'],
    }))
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:${this.partition}:iam::${account}:role/cdk-hnb659fds-*-role-${account}-${this.region}`],
    }))

    if (isProduction) {
      const instance = new lightsail.CfnInstance(this, 'ApiInstance', {
        instanceName: 'prod-wagaya-recipe-book-api',
        blueprintId: this.node.tryGetContext('lightsailBlueprintId') || 'ubuntu_22_04',
        bundleId: this.node.tryGetContext('lightsailBundleId') || 'medium_2_0',
        networking: {
          ports: [
            { fromPort: 80, toPort: 80, protocol: 'tcp' },
            { fromPort: 443, toPort: 443, protocol: 'tcp' },
          ],
        },
        addOns: [{
          addOnType: 'AutoSnapshot',
          status: 'Enabled',
          autoSnapshotAddOnRequest: { snapshotTimeOfDay: '18:00' },
        }],
        tags: [{ key: 'Application', value: 'wagaya-recipe-book' }, { key: 'Environment', value: 'production' }],
        userData: '#!/bin/bash\nset -eu\napt-get update\napt-get install -y ca-certificates curl docker.io docker-compose-v2\nsystemctl enable --now docker\ninstall -d -m 0750 /opt/wagaya-recipe-book\n',
      })
      const staticIp = new lightsail.CfnStaticIp(this, 'ApiStaticIp', {
        staticIpName: 'prod-wagaya-recipe-book-api-ip',
        attachedTo: instance.instanceName,
      })
      new cdk.CfnOutput(this, 'ApiStaticIpAddress', { value: staticIp.attrIpAddress })
      new cdk.CfnOutput(this, 'ApiInstanceName', { value: instance.instanceName })
    }

    new cdk.CfnOutput(this, 'ArchiveBucketName', { value: archiveBucket.bucketName })
    new cdk.CfnOutput(this, 'RuntimeCredentialsSecretArn', { value: runtimeCredentials.ref })
    new cdk.CfnOutput(this, 'ApplicationSettingsSecretArn', { value: applicationSettings.ref })
    new cdk.CfnOutput(this, 'GitHubDeployRoleArn', { value: deployRole.roleArn })
  }
}
