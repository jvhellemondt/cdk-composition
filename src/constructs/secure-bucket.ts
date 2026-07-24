import { RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface SecureBucketProps {
  readonly versioned?: boolean;
  readonly removalPolicy?: RemovalPolicy;
}

export class SecureBucket extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecureBucketProps = {}) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "Resource", {
      versioned: props.versioned ?? true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
    });
  }
}
