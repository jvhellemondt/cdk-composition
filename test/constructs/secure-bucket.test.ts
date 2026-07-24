import { App, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "bun:test";
import { SecureBucket } from "../../src/constructs/secure-bucket";

function synth(props = {}) {
  const app = new App();
  const stack = new Stack(app, "Stack");
  new SecureBucket(stack, "Bucket", props);
  return Template.fromStack(stack);
}

describe("SecureBucket", () => {
  test("encrypts with S3-managed keys", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
  });

  test("blocks all public access", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test("enforces SSL via bucket policy", () => {
    synth().hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "s3:*",
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      },
    });
  });

  test("versioned by default", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  test("versioning can be disabled", () => {
    synth({ versioned: false }).hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: Match.absent(),
    });
  });

  test("defaults to RETAIN removal policy", () => {
    const template = synth();
    const buckets = template.findResources("AWS::S3::Bucket");
    const bucket = Object.values(buckets)[0] as { DeletionPolicy?: string };
    expect(bucket.DeletionPolicy).toBe("Retain");
  });

  test("accepts a custom removal policy", () => {
    const template = synth({ removalPolicy: RemovalPolicy.DESTROY });
    const buckets = template.findResources("AWS::S3::Bucket");
    const bucket = Object.values(buckets)[0] as { DeletionPolicy?: string };
    expect(bucket.DeletionPolicy).toBe("Delete");
  });
});
