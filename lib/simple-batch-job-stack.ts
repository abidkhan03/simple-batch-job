import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { CfnComputeEnvironment, CfnJobDefinition, CfnJobQueue } from 'aws-cdk-lib/aws-batch';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { BatchJob } from 'aws-cdk-lib/aws-events-targets';
import { Effect, InstanceProfile, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { DefinitionBody, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import { BatchSubmitJob } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { DockerImageName, ECRDeployment } from 'cdk-ecr-deployment';
import { Construct } from 'constructs';
import { join } from 'path';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class SimpleBatchJobStack extends Stack {
  private readonly dockerImageAssetPath: string = join(__dirname, './aws-batch');
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    const ecrRepository = new Repository(this, 'BatchTestRepo', {
      repositoryName: 'simple-batch-test-repo',
    });

    const dockerImage = new DockerImageAsset(this, 'BatchTestImage', {
      directory: this.dockerImageAssetPath,
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

    const computeEnv = new CfnComputeEnvironment(this, 'testComputeEnv', {
      type: 'MANAGED',
      state: 'ENABLED',
      serviceRole: computeEnvRole.roleName,
      computeResources: {
        type: 'EC2',
        subnets: [vpc.publicSubnets[0].subnetId, vpc.publicSubnets[1].subnetId],
        securityGroupIds: [securityGroup.securityGroupId],
        instanceTypes: ["optimal"],
        minvCpus: 0,
        maxvCpus: 256,
        instanceRole: instanceComputeEnvProfile.instanceProfileArn,
      }
    });

    const jobQueue = new CfnJobQueue(this, 'BatchTestjobQueue', {
      jobQueueName: 'BatchTestjobQueue',
      priority: 10,
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

    const repository = Repository.fromRepositoryName(this, 'simple-batch-test-repo', ecrRepository.repositoryName);

    // Allow to get and put s3 objects
    ecsRole.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      resources: [repository.repositoryArn, repository.repositoryArn + ("*")],
      actions: [
        "s3:PutObject",
        "s3:GetObject"
      ]
    }));

    const jobDefinition = new CfnJobDefinition(this, 'BatchTestJobDefinition', {
      jobDefinitionName: 'batch-job-definition',
      platformCapabilities: ['EC2'],
      type: 'container',
      timeout: {
        attemptDurationSeconds: 900,
      },
      containerProperties: {
        image: ContainerImage.fromEcrRepository(repository).imageName,
        jobRoleArn: ecsRole.roleArn,
        executionRoleArn: ecsRole.roleArn,
        command: ['python', './main.py'],
        resourceRequirements: [
          {
            value: '1',
            type: 'VCPU',
          },
          {
            value: '2048',
            type: 'MEMORY',
          }
        ],
        logConfiguration: {
          logDriver: 'awslogs',
        }
      }
    });

    // Schedules Batch Job
    const exportScheduleRole = new Rule(this, 'batch-test-rule', {
      ruleName: 'batch-test-rule',
      description: 'This Rule Schedules the submission of Batch Jobs',
      schedule: Schedule.cron({ minute: '50', hour: '19' }),
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
      jobName: 'batch-submit-job-' + Date.now().toString(),
      jobQueueArn: jobQueue.attrJobQueueArn,
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
      timeout: Duration.minutes(30),
      role: stateMachineRole,
    });

  }
}
