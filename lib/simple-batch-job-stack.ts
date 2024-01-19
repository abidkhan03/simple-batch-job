import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { CfnComputeEnvironment, CfnJobDefinition, CfnJobQueue } from 'aws-cdk-lib/aws-batch';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { BatchJob } from 'aws-cdk-lib/aws-events-targets';
import { Effect, InstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { DefinitionBody, StateMachine, TaskInput } from 'aws-cdk-lib/aws-stepfunctions';
import { BatchSubmitJob } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { DockerImageName, ECRDeployment } from 'cdk-ecr-deployment';
import { Construct } from 'constructs';
import { join } from 'path';
import { ALPACA_CONFIG } from './configuration';

export class SimpleBatchJobStack extends Stack {
  private readonly dockerImageAssetPath: string = join(__dirname, './aws-batch');
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    const ecrRepository = new Repository(this, 'StockBatchtRepo', {
      repositoryName: 'stock-batch-test-repo',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const dockerImage = new DockerImageAsset(this, 'BatchStockImage', {
      directory: this.dockerImageAssetPath,
      buildArgs: {
        'ALPACA_API_KEY': ALPACA_CONFIG.Prod.ALPACA_API_KEY,
        'ALPACA_API_SECRET': ALPACA_CONFIG.Prod.ALPACA_API_SECRET
      }
    });

    const ecsTaskRole = new Role(this, 'EcsTaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    ecrRepository.grantPullPush(ecsTaskRole);

    new ECRDeployment(this, 'DeployDockerimage', {
      src: new DockerImageName(dockerImage.imageUri),
      dest: new DockerImageName(`${ecrRepository.repositoryUri}:latest`),
    });

    const securityGroup = new SecurityGroup(this, 'BatchTestSecurityGroup', {
      vpc: vpc,
      // allowAllOutbound: true,
      description: 'Security group for batch job',
    });

    // Role needed for Compute Environment to execute Containers
    const computeEnvRole = new Role(this, 'BatchComputeEnvRole', {
      roleName: 'BatchComputeEnvRole',
      assumedBy: new ServicePrincipal('batch.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBatchServiceRole'),
      ]
    });

    const instanceComputeEnvRole = new Role(this, 'InstanceComputeEnvRole', {
      roleName: 'InstanceComputeEnvRole',
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ]
    });

    const instanceComputeEnvProfile = new InstanceProfile(this, 'InstanceComputeEnvProfile', {
      role: instanceComputeEnvRole
    });

    const computeEnv = new CfnComputeEnvironment(this, 'StockComputeEnv1', {
      type: 'MANAGED',
      state: 'ENABLED',
      serviceRole: computeEnvRole.roleName,
      computeResources: {
        type: 'EC2',
        allocationStrategy: 'BEST_FIT_PROGRESSIVE',
        subnets: [vpc.publicSubnets[0].subnetId, vpc.publicSubnets[1].subnetId],
        securityGroupIds: [securityGroup.securityGroupId],
        instanceTypes: ["p2.xlarge"],
        minvCpus: 0,
        maxvCpus: 128,
        instanceRole: instanceComputeEnvProfile.instanceProfileArn,
      }
    });

    const jobQueue = new CfnJobQueue(this, 'BatchStockjobQueue', {
      jobQueueName: 'BatchStockJobQueueV1',
      priority: 100,
      computeEnvironmentOrder: [
        {
          order: 1,
          computeEnvironment: computeEnv.attrComputeEnvironmentArn,
        }
      ],
    });

    // Role for ECS
    const ecsRole = new Role(this, 'batch-ecs-role', {
      roleName: 'batch-ecs-role',
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        // Allow to Pull Image from ECR Repository 
        ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")]
    });

    const repository = Repository.fromRepositoryName(this, 'StockBatchRepo', ecrRepository.repositoryName);

    // Allow to get and put s3 objects
    ecsRole.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [repository.repositoryArn, repository.repositoryArn + ("*")],
      actions: [
        "s3:PutObject",
        "s3:GetObject"
      ]
    }));

    const jobDefinition = new CfnJobDefinition(this, 'BatchStockJobDefinition', {
      jobDefinitionName: 'batch-job-definitionV1',
      platformCapabilities: ['EC2'],
      type: 'container',
      timeout: {
        attemptDurationSeconds: 7200,
      },
      containerProperties: {
        image: ContainerImage.fromEcrRepository(repository).imageName,
        jobRoleArn: ecsRole.roleArn,
        executionRoleArn: ecsRole.roleArn,
        command: [
          'python', './stock_data.py',
          '--symbol', 'Ref::symbol',    // Referring to the payload keys
          '--start', 'Ref::start',
          '--end', 'Ref::end',
          '--timeframe', 'Ref::timeframe'
        ],
        // vcpus: 4,
        // memory: 8192,
        // runtimePlatform: {
        // // Only for fargate configuration
        //   cpuArchitecture: 'ARM64',
        //   operatingSystemFamily: 'LINUX',
        // },
        environment: [
          {
            name: 'ALPACA_API_KEY',
            value: ALPACA_CONFIG.Prod.ALPACA_API_KEY
          },
          {
            name: 'ALPACA_API_SECRET',
            value: ALPACA_CONFIG.Prod.ALPACA_API_SECRET
          }
        ],
        resourceRequirements: [
          {
            value: '4',
            type: 'VCPU',
          },
          {
            value: '8192',
            type: 'MEMORY',
          },
          {
            value: '1',
            type: 'GPU',
          }
        ],
        logConfiguration: {
          logDriver: 'awslogs',
        }
      }
    });

    // Schedules Batch Job
    const exportScheduleRole = new Rule(this, 'batch-stock-rule', {
      ruleName: 'batch-test-rule',
      description: 'This Rule Schedules the submission of Batch Jobs',
      schedule: Schedule.cron({ minute: '16', hour: '10' }),
    })

    // Add a target to the rule
    exportScheduleRole.addTarget(new BatchJob(
      jobQueue.attrJobQueueArn,
      jobQueue,
      jobDefinition.attrJobDefinitionArn,
      jobDefinition,
      {
        jobName: 'batch-export-job-' + Date.now().toString(),
      }
    ));

    // Submit Job to Batch
    const submitJob = new BatchSubmitJob(this, 'SubmitJob', {
      jobDefinitionArn: jobDefinition.attrJobDefinitionArn,
      jobName: 'batch-stock-job-' + Date.now().toString(),
      jobQueueArn: jobQueue.attrJobQueueArn,
      payload: TaskInput.fromObject({
        'symbol.$': '$.symbol',
        'start.$': '$.start',
        'end.$': '$.end',
        'timeframe.$': '$.timeframe',
      })
      // payload: TaskInput.fromObject({
      //   'symbol.$': TaskInput.fromJsonPathAt('$.symbol').value,
      //   'start.$': TaskInput.fromJsonPathAt('$.start').value,
      //   'end.$': TaskInput.fromJsonPathAt('$.end').value,
      //   'timeframe.$': TaskInput.fromJsonPathAt('$.timeframe').value,
      // })
    });

    const stateMachineRole = new Role(this, 'StateMachineRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
    })

    stateMachineRole.addToPolicy(new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: ['*']
    }));

    // Define the state machine
    const batchStateMachine = new StateMachine(this, 'BatchStateMachine', {
      definitionBody: DefinitionBody.fromChainable(submitJob),
      stateMachineName: 'BatchStateMachine',
      timeout: Duration.minutes(120),
      role: stateMachineRole,
    });

  }
}
