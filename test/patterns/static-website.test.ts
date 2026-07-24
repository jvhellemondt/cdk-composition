import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, test } from "bun:test";
import { StaticWebsite } from "../../src/patterns/static-website";

function synth(props = {}) {
  const app = new App();
  const stack = new Stack(app, "Stack");
  new StaticWebsite(stack, "Site", props);
  return Template.fromStack(stack);
}

describe("StaticWebsite", () => {
  test("creates a CloudFront distribution", () => {
    synth().resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("redirects HTTP to HTTPS", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
        },
      },
    });
  });

  test("serves index.html as root", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { DefaultRootObject: "index.html" },
    });
  });

  test("falls back to index.html on 403 for SPA routing", () => {
    synth().hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 403,
            ResponseCode: 200,
            ResponsePagePath: "/index.html",
          }),
        ]),
      },
    });
  });

  test("wires distribution to an S3 bucket via OAC", () => {
    synth().resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  });

  test("asset bucket is not versioned", () => {
    synth().hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: Match.absent(),
    });
  });
});
